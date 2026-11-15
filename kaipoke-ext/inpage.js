// カイポケのタブの中で動く関数（chrome.scripting.executeScript で呼ぶので、この関数の外の変数は使えない）
// task.kind：
//   office … 事業所（レセプトTOPのリンク名）に入り、各種情報出力の「利用者情報」「被保険者証情報」CSVを読む
//   hnc    … 訪問看護（bizhnc）の「利用者情報」「被保険者証情報」CSVを読む
//   houkai … 訪問介護のシフト表（日ごとのJSON）から、その月の訪問予定を読む
//   houkan … 訪問看護のスケジュール表（職員）から、その月の訪問予定を読む
//   careplan … 居宅介護支援の利用票（利用者別予実）から、アロハ以外の事業所のサービスと日時を読む
// ※利用者情報CSVには銀行・口座の列があるが、ここで捨てて外へは出さない
async function kpTask(task){
  const parse=h=>new DOMParser().parseFromString(h,'text/html');
  const isLogin=(url,html)=>/\/login\//i.test(url||'')||/<title>[^<]*ログイン[^<]*<\/title>/.test(html||'');
  const get=async u=>{ const r=await fetch(u,{credentials:'include'}); const html=await r.text(); if(isLogin(r.url,html)) throw new Error('カイポケにログインしていません'); return {url:r.url,html}; };
  const formData=(f,extra)=>{ const fd=new URLSearchParams(); for(const el of f.elements){ if(!el.name) continue; if((el.type==='checkbox'||el.type==='radio')&&!el.checked) continue; if(['submit','button','image'].includes(el.type)) continue; fd.append(el.name,el.value); } for(const [k,v] of Object.entries(extra||{})) fd.set(k,v); return fd; };
  const submitLink=async(doc,baseUrl,a)=>{
    const oc=a.getAttribute('onclick')||''; const m=oc.match(/oamSubmitForm\('([^']+)','([^']+)',null,(\[.*?\])\)/)||oc.match(/oamSubmitForm\('([^']+)','([^']+)'/);
    if(!m){ const href=a.getAttribute('href'); if(href&&href!=='#'&&!/^javascript/i.test(href)) return get(new URL(href,baseUrl).href); throw new Error('画面のリンクの形式が想定と違います'); }
    const f=doc.forms[m[1]]||doc.getElementById(m[1]); const fd=formData(f);
    if(m[3]) for(const x of m[3].matchAll(/\['([^']*)','([^']*)'\]/g)) fd.set(x[1],x[2]);
    fd.set(m[1]+':_idcl',m[2]);
    const r=await fetch(new URL(f.getAttribute('action'),baseUrl).href,{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fd.toString()});
    const html=await r.text(); if(isLogin(r.url,html)) throw new Error('カイポケにログインしていません'); return {url:r.url,html};
  };
  const click=async(page,re,formId)=>{ const doc=parse(page.html); const a=[...doc.querySelectorAll('a')].find(x=>re.test(x.textContent.trim())&&(!formId||new RegExp("oamSubmitForm\\('"+formId+"'").test(x.getAttribute('onclick')||''))); if(!a) throw new Error('カイポケの画面に「'+String(re).replace(/[\/^$\\]/g,'')+'」が見つかりません'); return submitLink(doc,page.url,a); };
  const exportCsv=async(page,checkAll)=>{ const doc=parse(page.html); const f=doc.forms['form']; if(!f) throw new Error('出力条件の画面が開けません'); if(checkAll) f.querySelectorAll('input[type=checkbox]').forEach(c=>c.checked=true); const fd=formData(f,{'form:_idcl':'form:export'}); const r=await fetch(new URL(f.getAttribute('action'),page.url).href,{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fd.toString()}); return new TextDecoder('shift_jis').decode(await r.arrayBuffer()); };
  const parseCsv=text=>{ const rows=[]; let row=[],cell='',q=false; for(let i=0;i<text.length;i++){ const c=text[i]; if(q){ if(c==='"'){ if(text[i+1]==='"'){cell+='"';i++;} else q=false; } else cell+=c; } else if(c==='"') q=true; else if(c===','){row.push(cell);cell='';} else if(c==='\n'||c==='\r'){ if(c==='\r'&&text[i+1]==='\n') i++; row.push(cell); rows.push(row); row=[]; cell=''; } else cell+=c; } if(cell||row.length){row.push(cell);rows.push(row);} return rows.filter(r=>r.some(x=>x!=='')); };
  const pick=(text,cols)=>{ const rows=parseCsv(text); if(!rows.length) return []; const h=rows[0].map(x=>x.replace(/^﻿/,'').trim()); return rows.slice(1).map(r=>{ const o={}; cols.forEach(c=>{ const i=h.indexOf(c); if(i>=0) o[c]=(r[i]||'').trim(); }); return o; }).filter(o=>o['利用者名']); };
  const USER_COLS=['利用者名','利用者カナ','利用者生年月日','性別','都道府県','市区町村','町名以下','建物名','利用者状態'];
  const HOKEN_COLS=['利用者名','利用者カナ','被保険者証認定区分','保険者名','要介護度','認定年月日','認定有効開始年月日','認定有効終了年月日','担当居宅支援事業所','担当ケアマネ','担当地域包括支援センター'];
  const TOP='/kaipokebiz/common/COM020101.do?fromBP=true';
  try{
    // ケアマネの利用票（予定・実績管理 利用者別）から、アロハ以外の事業所のサービスを読む
    if(task.kind==='careplan'){
      const parseD=h=>new DOMParser().parseFromString(h,'text/html');
      const post=async(pg,set)=>{ const doc=parseD(pg.html); const f=doc.forms['form']; if(!f) throw new Error('利用票の画面が開けません'); const fd=formData(f); for(const [k,v] of Object.entries(set)) fd.set(k,v); const r=await fetch(new URL(f.getAttribute('action'),pg.url).href,{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fd.toString()}); const html=await r.text(); if(isLogin(r.url,html)) throw new Error('カイポケにログインしていません'); if(!r.ok) throw new Error('カイポケの利用票の画面でエラーになりました（'+r.status+'）'); return {url:r.url,html}; };
      const office=await click(await get(TOP),/^居宅介護支援\//);
      const list=await click(office,/^利用者別予実登録$/);
      const ldoc=parseD(list.html); const first=[...ldoc.querySelectorAll('a')].find(a=>/userInternalId/.test(a.getAttribute('onclick')||''));
      if(!first) throw new Error('利用票の利用者一覧が見つかりません');
      let pg=await submitLink(ldoc,list.url,first);
      const ym=task.ym.replace('-','');
      { const d=parseD(pg.html); const cur=(d.querySelector('select[name="form:serviceOfferYmSelectId"]')||{}).value;
        if(cur!==ym){ const a=[...d.querySelectorAll('a')].find(x=>/^(次月|前月)$/.test(x.textContent.trim())); const m=a&&(a.getAttribute('onclick')||'').match(/oamSubmitForm\('([^']+)','([^']+)'/); if(!m) throw new Error('利用票の月を切り替えられません'); pg=await post(pg,{'form:_idcl':m[2],'ServiceOfferDate':ym}); }
        const d2=parseD(pg.html); if((d2.querySelector('select[name="form:serviceOfferYmSelectId"]')||{}).value!==ym) return {visits:[],offices:[],skip:true}; }
      const ids=[...parseD(pg.html).querySelector('select[name="form:userId"]').options].map(o=>o.value).filter(Boolean);
      const ALOHA=/^アロハ/; const visits=[], offices=[]; const [Y,M]=task.ym.split('-').map(Number);
      for(const id of (task.limit?ids.slice(0,task.limit):ids)){
        pg=await post(pg,{'form:userId':id,'form:_idcl':'form:changeUser'});
        const d=parseD(pg.html); const user=(d.title||'').split(/\s*様/)[0].trim(); if(!user) continue;
        const plan={}; for(const s of d.querySelectorAll('script')) for(const m of s.textContent.matchAll(/push\('(\d+)'\);\s*x_\d+\.push\('([0-9]*)'\)/g)) plan[m[1]]=m[2];
        const t=d.getElementById('tblDetails'); if(!t) continue;
        for(const row of t.rows){ const c=[...row.cells]; if(c.length<6||c[4].textContent.trim()!=='予定') continue;
          const off=c[3].textContent.replace(/\s+/g,' ').trim(), svc=c[2].textContent.replace(/\s+/g,'').trim(); if(!off||ALOHA.test(off)) continue;
          const days=plan[(row.querySelector('input[name=radioCopy]')||{}).value]||'';
          if(!/加算|減算/.test(svc)) offices.push({user,office:off,service:svc});
          const tm=c[1].textContent.replace(/\s+/g,'').match(/(\d{1,2}:\d{2})[～~〜-](\d{1,2}:\d{2})/); if(!tm) continue;
          for(let i=0;i<days.length;i++) if(+days[i]>0) visits.push({user,office:off,service:svc,date:`${Y}-${String(M).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`,start:tm[1].padStart(5,'0'),end:tm[2].padStart(5,'0')});
        }
      }
      return {visits,offices,users:ids.length};
    }
    if(task.kind==='office'){
      const re=new RegExp(task.link);
      const office=await click(await get(TOP),re);
      const sel=await click(office,/^出力対象選択$/);
      const u=await click(sel,/^利用者情報$/,'form');
      const users=pick(await exportCsv(u,false),USER_COLS);
      let hoken=[];
      if(task.hoken){ const sel2=await click(u,/^出力対象選択$/); const h=await click(sel2,/^被保険者証情報$/,'form'); hoken=pick(await exportCsv(h,true),HOKEN_COLS); }
      return {users,hoken};
    }
    if(task.kind==='hnc'){
      const office=await click(await get(TOP),/^訪問看護\//);
      const doc=parse(office.html); const a=[...doc.querySelectorAll('a')].find(x=>x.textContent.trim()==='出力対象選択'); if(!a) throw new Error('訪問看護の出力対象選択が見つかりません');
      const selUrl=new URL(a.getAttribute('href'),office.url).href;
      const u=await click(await get(selUrl),/^利用者情報$/,'form');
      const users=pick(await exportCsv(u,false),USER_COLS);
      const h=await click(await get(selUrl),/^被保険者証情報$/,'form');
      const hoken=pick(await exportCsv(h,true),HOKEN_COLS);
      return {users,hoken};
    }
    // 訪問看護の利用者一覧（CSV出力＝HNC09000P1）：医療保険の種類・適用期間、主治医・医療機関
    if(task.kind==='hncList'){
      const load=async()=>{ const p=await get('/bizhnc/manageSchedule/'); const k=p.html.indexOf('manageScheduleObj'); if(k<0) return null; const s=p.html.indexOf('{',k); let depth=0,i=s,inStr=false; for(;i<p.html.length;i++){ const c=p.html[i]; if(inStr){ if(c==='\\'){i++;continue;} if(c==='"') inStr=false; continue; } if(c==='"'){inStr=true;continue;} if(c==='{') depth++; else if(c==='}'){ depth--; if(depth===0) break; } } return {page:p, obj:JSON.parse(p.html.slice(s,i+1))}; };
      let L=await load(); if(!L){ await click(await get(TOP),/^訪問看護\//); L=await load(); }
      if(!L) throw new Error('訪問看護の利用者一覧が開けません');
      const f=parse(L.page.html).forms['exportForm']; if(!f) throw new Error('訪問看護の利用者一覧のCSV出力が見つかりません');
      const fd=formData(f); fd.set('userExport',(L.obj.list||[]).map(x=>x.userInternalId).join(';')+';');
      const r=await fetch(new URL(f.getAttribute('action'),L.page.url).href,{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fd.toString()});
      const rows=pick(new TextDecoder('shift_jis').decode(await r.arrayBuffer()),['利用者名','利用者カナ','医療保険種類','医療被保証適用期間(自)','医療被保証適用期間(至)','医療機関名','主治医名','医療機関電話番号']);
      return {rows};
    }
    // 障害（訪問系）の利用者請求CSV：負担上限月額（今月の請求が無ければ前月）
    if(task.kind==='shogaiClaim'){
      const office=await click(await get(TOP),/^障害者総合支援/);
      const sel=await click(office,/^出力対象選択$/);
      const c=await click(sel,/^利用者請求$/,'form');
      const run=async back=>{ const doc=parse(c.html); const f=doc.forms['form']; if(!f) throw new Error('利用者請求の出力条件が開けません');
        if(back){ const y=f.querySelector('[name="form:periodFromYear"]'), m=f.querySelector('[name="form:periodFromMonth"]'); if(y&&m){ let yy=+y.value, mm=+m.value-1; if(mm<1){mm=12;yy--;} y.value=String(yy); m.value=String(mm); } }
        const fd=formData(f,{'form:_idcl':'form:export'}); const r=await fetch(new URL(f.getAttribute('action'),c.url).href,{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fd.toString()});
        return pick(new TextDecoder('shift_jis').decode(await r.arrayBuffer()),['利用者名','負担上限月額','請求年月']); };
      let rows=await run(false); if(!rows.length) rows=await run(true);
      return {rows};
    }
    const [Y,M]=String(task.ym).split('-').map(Number); const ymv=`${Y}${String(M).padStart(2,'0')}`; const last=new Date(Y,M,0).getDate(); const p2=n=>String(n).padStart(2,'0');
    // 通所介護（デイサービス）：提供日別実績登録の画面を1日ずつ読み、利用予定にする（加算の行はまとめる）
    if(task.kind==='day'){
      const office=await click(await get(TOP),/^通所介護\//);
      let page=await click(office,/^提供日別実績登録$/);
      const postDay=async(pg,extra)=>{ const doc=parse(pg.html); const f=doc.forms['form']; if(!f) throw new Error('デイサービスの提供日別実績登録が開けません'); const fd=formData(f,extra); const r=await fetch(new URL(f.getAttribute('action'),pg.url).href,{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fd.toString()}); const html=await r.text(); if(isLogin(r.url,html)) throw new Error('カイポケにログインしていません'); return {url:r.url,html}; };
      page=await postDay(page,{'form:_idcl':'service-offer-date-action','ServiceOfferDate':ymv,'ServiceOfferDay':'1','serviceOfferYmValueId':ymv,'serviceOfferDayValueId':'1'});
      const out=[];
      for(let d=1; d<=last; d++){
        if(d>1) page=await postDay(page,{'form:_idcl':'service-offer-day-action','ServiceOfferDay':String(d),'serviceOfferDayValueId':String(d)});
        const doc=parse(page.html);
        if(!new RegExp('^'+M+'月'+d+'日分').test(doc.title.trim())) throw new Error('デイサービスの'+M+'月'+d+'日の予定が開けません');
        const t=[...doc.querySelectorAll('table')].find(t=>/利用者名/.test(t.textContent)&&/提供時間/.test(t.textContent)); if(!t) continue;
        const byUser=new Map();
        for(const r of [...t.rows].slice(1)){ const c=[...r.cells].map(x=>x.textContent.replace(/\s+/g,' ').trim()); if(c.length<6) continue;
          const user=c[1].replace(/\s*\d{6,}\s*$/,'').trim(); if(!user) continue;
          const tm=c[3].match(/(\d{1,2}:\d{2})\D+(\d{1,2}:\d{2})/); const svc=c[4];
          const o=byUser.get(user); const main=!/加算|減算|処遇|特定|ベースアップ/.test(svc);
          if(!o) byUser.set(user,{src:'デイ',staff:'',date:`${Y}-${p2(M)}-${p2(d)}`,start:tm?tm[1].padStart(5,'0'):'',end:tm?tm[2].padStart(5,'0'):'',user,service:svc,_main:main});
          else if(main&&!o._main){ o.service=svc; o._main=true; }
        }
        for(const o of byUser.values()){ delete o._main; if(o.start) out.push(o); }
      }
      return {visits:out};
    }
    if(task.kind==='houkai'){
      const post=async u=>{ const r=await fetch(u,{method:'POST',credentials:'include',headers:{'X-Requested-With':'XMLHttpRequest'}}); const t=await r.text(); try{ return JSON.parse(t); }catch(e){ throw new Error('カイポケにログインしていないか、訪問介護のシフト表が読めません'); } };
      // 訪問介護のシフト表に入っておく（会社ID・事業所IDは画面の値。読めないときは既定値）
      await click(await get(TOP),/^訪問介護\/1373205846/).catch(()=>null);
      const company=task.company||'121782'; const names={};
      for(const [plant,kind] of (task.plants||[['99487','0003'],['99487','0024']])){ try{ const st=await post(`/kaipokebiz/shiftTable/staffListWithCondition/${company}/${plant}/${kind}/${ymv}/01`); (st.staff||[]).forEach(s=>{ names[s.staffMemberInternalId]=s.name; }); }catch(e){} }
      const out=[];
      for(let d=1; d<=last; d++){
        const j=await post(`/kaipokebiz/shiftTable/monthlyShiftByDay/${company}/${ymv}/${p2(d)}`);
        for(const p of (j.plans||[])){
          if(!p.userName) continue;
          if(/交通費|キャンセル料/.test(p.contentName||'')) continue;
          out.push({src:'訪介',staff:names[p.staffMemberInternalId]||'（職員不明）',date:`${Y}-${p2(M)}-${p2(d)}`,start:(p.startTime||'').padStart(5,'0'),end:(p.endTime||'').padStart(5,'0'),user:String(p.userName).replace(/[（(].*$/,'').trim(),service:[p.operationType,p.contentName].filter(Boolean).join(' '),note:p.remarks||'',kind:p.serviceKind||''});
        }
      }
      return {visits:out};
    }
    if(task.kind==='houkan'){
      let page=await get('/bizhnc/staffSchedule/?isFromMenuBizhnc=true'); let form=parse(page.html).forms['staffScheduleForm'];
      if(!form){ await click(await get(TOP),/^訪問看護\//); page=await get('/bizhnc/staffSchedule/?isFromMenuBizhnc=true'); form=parse(page.html).forms['staffScheduleForm']; }
      if(!form) throw new Error('訪問看護のスケジュール表（職員）が開けません');
      const base=formData(form); const action=new URL(form.getAttribute('action'),page.url).href;
      const extract=html=>{ const k=html.indexOf('"lsStaffServiceByWeekDtos"'); if(k<0) return []; const s=html.lastIndexOf('[{"staffMemberInternalId"',k); if(s<0) return []; let depth=0,i=s; for(;i<html.length;i++){ const c=html[i]; if(c==='[') depth++; else if(c===']'){ depth--; if(depth===0) break; } } try{ return JSON.parse(html.slice(s,i+1)); }catch(e){ return []; } };
      const out=new Map();
      for(let d=1; d<=last; d+=7){
        const fd=new URLSearchParams(base); fd.set('currentDate',`${Y}/${p2(M)}/${p2(d)}`); fd.set('isSearch','1');
        const html=await (await fetch(action,{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fd.toString()})).text();
        if(isLogin('',html)) throw new Error('カイポケにログインしていません');
        let list=extract(html);
        for(let off=list.length,g=0; g<20; g++){ const b=new URLSearchParams(fd); b.set('offset',String(off)); let j; try{ j=await (await fetch('/bizhnc/staffSchedule/searchScheduleStaffOffset/',{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest'},body:b.toString()})).json(); }catch(e){ break; } if(!j||!j.list||!j.list.length) break; list=list.concat(j.list); off+=j.list.length; if(j.list.length<9) break; }
        for(const s of list){ const staff=`${s.staffMemberSurname||''} ${s.staffMemberName||''}`.trim();
          for(const w of (s.lsStaffServiceByWeekDtos||[])){ if(String(w.serviceOfferYm)!==ymv) continue; const date=`${Y}-${p2(M)}-${p2(w.enforcementDay)}`;
            for(const it of (w.lsByEnforcementDayDtos||[])){
              const user=it.userName?`${it.userSurname||''} ${it.userName||''}`.trim():''; const op=it.individualOperationName||''; const st=it.serviceOfferStartTime||'', en=it.serviceOfferEndTime||'';
              const ins=String(it.insuranceDivision||''); const kubun=/^0[12]$/.test(ins)?'介護':ins==='88'?'医療':user?'保険外':'';
              const oncall=/オンコール/.test(op)||(!user&&st==='00:00'&&en==='00:00');
              const v={src:'訪看',staff,date,start:st,end:en,user,service:user?kubun:op,other:!user,oncall};
              out.set([v.staff,v.date,v.start,v.end,v.user,v.service].join('|'),v);
            } } }
      }
      return {visits:[...out.values()]};
    }
    throw new Error('不明な処理です');
  }catch(e){ return {__error:String(e&&e.message||e)}; }
}
