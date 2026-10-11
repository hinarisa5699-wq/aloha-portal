// カイポケのタブの中で動く関数（chrome.scripting.executeScript で呼ぶので、この関数の外の変数は使えない）
// task.kind：
//   office … 事業所（レセプトTOPのリンク名）に入り、各種情報出力の「利用者情報」「被保険者証情報」CSVを読む
//   hnc    … 訪問看護（bizhnc）の「利用者情報」「被保険者証情報」CSVを読む
//   houkai … 訪問介護のシフト表（日ごとのJSON）から、その月の訪問予定を読む
//   houkan … 訪問看護のスケジュール表（職員）から、その月の訪問予定を読む
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
    const [Y,M]=String(task.ym).split('-').map(Number); const ymv=`${Y}${String(M).padStart(2,'0')}`; const last=new Date(Y,M,0).getDate(); const p2=n=>String(n).padStart(2,'0');
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
