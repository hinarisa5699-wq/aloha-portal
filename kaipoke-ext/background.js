// アロハ業務ポータル カイポケ更新：ポータルの「カイポケから更新」から呼ばれ、カイポケのタブ（裏で開く）で読み取りをして結果を返す
importScripts('inpage.js');

// 部署ごとに読むもの
const OFFICES={
  'ヘルパー':[ {key:'ヘルパー介護', link:'^訪問介護\\/1373205846', hoken:true, kubun:'介護'},
               {key:'ヘルパー支援', link:'^訪問介護\\/13A3200238', hoken:true, kubun:'支援'},
               {key:'ヘルパー障害', link:'^障害者総合支援', hoken:false, kubun:'障害'} ],
  'ナース':   [ {key:'ナース', hnc:true} ],
  'ケアマネ': [ {key:'ケアマネ', link:'^居宅介護支援\\/', hoken:true, kubun:''} ],
  'デイサービス':[ {key:'デイサービス', link:'^通所介護\\/', hoken:true, kubun:''} ]
};

async function createTabRetry(opts){ let last; for(let i=0;i<8;i++){ try{ return await chrome.tabs.create(opts); }catch(e){ last=e; if(!/cannot be edited|dragging/i.test(String(e&&e.message||e))) throw e; await new Promise(r=>setTimeout(r,1500)); } } throw new Error('タブを開けませんでした：'+(last&&last.message||last)); }
// ログイン画面のURLを開く：ログイン中ならトップへ自動で戻る。
// ログイン画面のままなら、そのタブを前に出して、ログインが終わるまで最大5分待つ（v1.4.0）
async function kaipokeTab(say){
  const tab=await createTabRetry({url:'https://r.kaipoke.biz/kaipokebiz/login/COM020102.do',active:false});
  await new Promise(resolve=>{ const t=setTimeout(done,20000); function done(){ clearTimeout(t); chrome.tabs.onUpdated.removeListener(h); resolve(); } function h(id,info){ if(id===tab.id&&info.status==='complete') done(); } chrome.tabs.onUpdated.addListener(h); });
  await new Promise(r=>setTimeout(r,800));
  let cur=await chrome.tabs.get(tab.id).catch(()=>null);
  if(!cur) throw new Error('カイポケのタブを開けませんでした');
  if(!/\/login\//i.test(cur.url||'')) return tab;
  // 未ログイン：タブを前に出してログインを待つ
  try{ await chrome.tabs.update(tab.id,{active:true}); if(cur.windowId!=null) await chrome.windows.update(cur.windowId,{focused:true}); }catch(e){}
  const LIMIT=5*60*1000, start=Date.now(); let lastSay=0;
  while(Date.now()-start<LIMIT){
    await new Promise(r=>setTimeout(r,2000));
    cur=await chrome.tabs.get(tab.id).catch(()=>null);
    if(!cur) throw new Error('カイポケのタブが閉じられたので、更新をやめました。もう一度「カイポケから更新」を押してください');
    if(!/\/login\//i.test(cur.url||'')&&cur.status==='complete'){
      say({type:'progress',text:'カイポケにログインできました。読み取りを始めます…'});
      await new Promise(r=>setTimeout(r,1500));
      return tab;
    }
    if(Date.now()-lastSay>=15000){ lastSay=Date.now(); const left=Math.ceil((LIMIT-(Date.now()-start))/60000);
      say({type:'progress',text:`カイポケのログイン画面を開きました。ログインしてください（あと${left}分待ちます。ログインしたら自動で続きます）`}); }
  }
  chrome.tabs.remove(tab.id).catch(()=>{});
  throw new Error('5分たってもカイポケにログインできなかったので、更新をやめました。ログインしてから、もう一度「カイポケから更新」を押してください');
}
async function run(tabId, task){
  const [r]=await chrome.scripting.executeScript({target:{tabId}, func:kpTask, args:[task]});
  if(!r||!r.result) throw new Error('カイポケのタブで実行できませんでした');
  if(r.result.__error) throw new Error(r.result.__error);
  return r.result;
}

chrome.runtime.onConnectExternal.addListener(port=>{
  if(port.name!=='kaipoke-sync') return;
  let alive=true; port.onDisconnect.addListener(()=>{ alive=false; });
  const say=(m)=>{ if(alive) try{ port.postMessage(m); }catch(e){} };
  port.onMessage.addListener(async msg=>{
    if(msg.type==='ping'){ say({type:'pong',version:chrome.runtime.getManifest().version}); return; }
    if(msg.type!=='sync') return;
    let tab=null;
    try{
      tab=await kaipokeTab(say);
      const result={depts:msg.depts, months:msg.months, offices:{}, visits:{}};
      for(const dept of msg.depts){
        for(const o of (OFFICES[dept]||[])){
          say({type:'progress',text:`${o.key}：利用者情報を読み取り中…`});
          const r=await run(tab.id, o.hnc?{kind:'hnc'}:{kind:'office',link:o.link,hoken:o.hoken});
          result.offices[o.key]={dept, kubun:o.kubun||'', users:r.users, hoken:r.hoken};
          say({type:'progress',text:`${o.key}：利用者${r.users.length}名・被保険者証${r.hoken.length}件`});
          if(o.hnc){ say({type:'progress',text:'訪問看護：医療保険・主治医を読み取り中…'}); const x=await run(tab.id,{kind:'hncList'}); result.offices[o.key].iryo=x.rows; say({type:'progress',text:`訪問看護：医療保険 ${x.rows.length}名分`}); }
          if(o.key==='ヘルパー障害'){ say({type:'progress',text:'障害：負担上限月額を読み取り中…'}); const x=await run(tab.id,{kind:'shogaiClaim'}); result.offices[o.key].jogen=x.rows; say({type:'progress',text:`障害：負担上限月額 ${x.rows.length}名分`}); }
        }
      }
      const vk=[]; if(msg.depts.includes('ヘルパー')) vk.push(['houkai','訪問介護のシフト']); if(msg.depts.includes('ナース')) vk.push(['houkan','訪問看護のスケジュール']); if(msg.depts.includes('デイサービス')) vk.push(['day','デイサービスの利用予定']);
      for(const [kind,label] of vk){ result.visits[kind]={};
        for(const ym of msg.months){ say({type:'progress',text:`${label}（${ym}）を読み取り中…`}); const r=await run(tab.id,{kind,ym}); result.visits[kind][ym]=r.visits; say({type:'progress',text:`${label}（${ym}）：${r.visits.length}件`}); } }
      if(msg.depts.includes('ケアマネ')){ result.gaibu={};
        for(const ym of msg.months){ say({type:'progress',text:`ケアマネの利用票（${ym}）：アロハ以外の事業所の予定を読み取り中…（利用者が多いので2〜3分かかります）`});
          const r=await run(tab.id,{kind:'careplan',ym}); if(r.skip){ say({type:'progress',text:`ケアマネの利用票（${ym}）：まだ作られていません`}); continue; }
          result.gaibu[ym]={visits:r.visits,offices:r.offices}; say({type:'progress',text:`ケアマネの利用票（${ym}）：他社の予定 ${r.visits.length}件・関係事業所 ${new Set(r.offices.map(o=>o.user+'|'+o.office)).size}件`}); } }
      say({type:'done',result});
    }catch(e){ say({type:'error',error:String(e&&e.message||e)}); }
    finally{ if(tab&&tab.id) chrome.tabs.remove(tab.id).catch(()=>{}); }
  });
});
