// ポータルの画面に、この拡張機能のID（ポータルから呼び出すために必要）を知らせる
try{ localStorage.setItem('kp_ext_id', chrome.runtime.id); localStorage.setItem('kp_ext_ver', chrome.runtime.getManifest().version); }catch(e){}
