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
// ログイン画面のURLを開く：ログイン中ならトップへ自動で戻る。ログイン画面のままなら未ログイン
async function kaipokeTab(){
  const tab=await createTabRetry({url:'https://r.kaipoke.biz/kaipokebiz/login/COM020102.do',active:false});
  await new Promise(resolve=>{ const t=setTimeout(done,20000); function done(){ clearTimeout(t); chrome.tabs.onUpdated.removeListener(h); resolve(); } function h(id,info){ if(id===tab.id&&info.status==='complete') done(); } chrome.tabs.onUpdated.addListener(h); });
  await new Promise(r=>setTimeout(r,800));
  const cur=await chrome.tabs.get(tab.id).catch(()=>null);
  if(!cur) throw new Error('カイポケのタブを開けませんでした');
  if(/\/login\//i.test(cur.url||'')){ chrome.tabs.remove(tab.id).catch(()=>{}); throw new Error('カイポケにログインしていません。カイポケにログインしてから、もう一度押してください'); }
  return tab;
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
      tab=await kaipokeTab();
      const result={depts:msg.depts, months:msg.months, offices:{}, visits:{}};
      for(const dept of msg.depts){
        for(const o of (OFFICES[dept]||[])){
          say({type:'progress',text:`${o.key}：利用者情報を読み取り中…`});
          const r=await run(tab.id, o.hnc?{kind:'hnc'}:{kind:'office',link:o.link,hoken:o.hoken});
          result.offices[o.key]={dept, kubun:o.kubun||'', users:r.users, hoken:r.hoken};
          say({type:'progress',text:`${o.key}：利用者${r.users.length}名・被保険者証${r.hoken.length}件`});
        }
      }
      const vk=[]; if(msg.depts.includes('ヘルパー')) vk.push(['houkai','訪問介護のシフト']); if(msg.depts.includes('ナース')) vk.push(['houkan','訪問看護のスケジュール']);
      for(const [kind,label] of vk){ result.visits[kind]={};
        for(const ym of msg.months){ say({type:'progress',text:`${label}（${ym}）を読み取り中…`}); const r=await run(tab.id,{kind,ym}); result.visits[kind][ym]=r.visits; say({type:'progress',text:`${label}（${ym}）：${r.visits.length}件`}); } }
      say({type:'done',result});
    }catch(e){ say({type:'error',error:String(e&&e.message||e)}); }
    finally{ if(tab&&tab.id) chrome.tabs.remove(tab.id).catch(()=>{}); }
  });
});
