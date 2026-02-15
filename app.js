/***********************************************
 * v1.33a 変更点
 * - 怪獣デッキ生成順を反転：デッキ構築画面左→右の順で上になる
 * - [patch] 消滅ボタンの追加（選択カード削除）
 * - [patch] ドロー順序を「サーチ表示の左上から」= deckPool先頭からに変更
 * - [patch] 盤面→山札へ戻す位置を「上/下」から選択できるUIを追加
 ***********************************************/

const URL_PARAMS = new URLSearchParams(location.search);
const IS_EMBED = URL_PARAMS.get('embed') === '1';
const FLIP_LAYOUT = URL_PARAMS.get('flip') === '1';
const IS_SOLO_ROOT = URL_PARAMS.get('solo_root') === '1';
const APP_VERSION = 'v2.2.0';
// ====== 画像DB作成 ======
const CARD_FOLDER = 'カードリスト';

function rangeIds(prefix, from, to, opts = {}) {
  const { pad = 3, suffix = '' } = opts;
  const arr = [];
  for (let i = from; i <= to; i++) {
    const num = pad ? String(i).padStart(pad, '0') : String(i); // pad=0なら埋めない
    arr.push(`${prefix}-${num}${suffix}`);
  }
  return arr;
}


function getSetKeyFromId(id){
  const s = String(id||'');
  // SD{種類(1/2)} は SD1 / SD2 に正規化（SD01/SD02 も吸収）
  let m = s.match(/^SD0?([12])/);
  if(m) return 'SD' + m[1];

  // BP{段数} は 2桁に正規化（BP1 も BP01 へ）
  m = s.match(/^BP(\d{1,2})/);
  if(m){
    const n = String(parseInt(m[1],10)).padStart(2,'0');
    return 'BP' + n;
  }

  // FC は 2桁に正規化
  m = s.match(/^FC(\d{1,2})/);
  if(m){
    const n = String(parseInt(m[1],10)).padStart(2,'0');
    return 'FC' + n;
  }

  if(s.startsWith('PR')) return 'PR';
  return 'OTHER';
}

const IDS = [
  ...rangeIds('SD01', 1, 15, { suffix: 'ol' }),
  ...rangeIds('SD02', 1, 15, { suffix: 'ol' }),
  ...rangeIds('BP01', 1, 80, { suffix: 'ol' }),

  // ol なし系
  ...rangeIds('BP02', 1, 80, { suffix: '' }),
  ...rangeIds('BP03', 1, 80, { suffix: '' }),
  ...rangeIds('FC01', 1, 6, { suffix: '' }), 
  ...rangeIds('PR', 1, 14, { suffix: '' }), 
  ...rangeIds('BP04', 1, 90, { suffix: '' }), 
];

const CARD_DB = IDS.map(id => ({
  id,
  name: id,
  set: getSetKeyFromId(id),
  deck: 'main',
  srcGuess: `${CARD_FOLDER}/${id}.png`,
}));

// ===== Card Meta (from card_meta.js) =====
const CARD_META = (typeof window!=='undefined' && window.CARD_META) ? window.CARD_META : {};
function normalizeIdVariants(id){
  const s=String(id||'');
  const v=[s];
  if(s.endsWith('ol')) v.push(s.replace(/ol$/,''));
  else v.push(s+'ol');
  // SD01/SD02 を SD1/SD2 で来るケースなどがあればここで追加できる
  return [...new Set(v)];
}
function getMetaById(id){
  const vars=normalizeIdVariants(id);
  for(const k of vars){ if(CARD_META && CARD_META[k]) return CARD_META[k]; }
  return null;
}
function hydrateCardsFromMeta(){
  try{
    CARD_DB.forEach(c=>{
      const m=getMetaById(c.id);
      if(!m) return;
      if(m.name) c.name = m.name; // 検索用 name を日本語名へ
      c.meta = m;
    });
  }catch(e){}
}
hydrateCardsFromMeta();

const WHITE_BACK="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3kqE0AAAAASUVORK5CYII=";
const CARD_BACK_SRC=`${CARD_FOLDER}/裏面.png`;
const MAX_DUP_PER_NAME=4,MAX_SAVE_BYTES=4_500_000;const MAIN_LIMIT=50,MON_LIMIT=4;
let backSrc=WHITE_BACK;let rageCount=0;

// DOM refs
const board=document.getElementById('board');
const fileInput=document.getElementById('fileInput');
const backInput=document.getElementById('backInput');
const deckCounterEl=document.getElementById('deckCounter');
const discardCounterEl=document.getElementById('discardCounter');
const monsterCounterEl=document.getElementById('monsterCounter');
const toolbar=document.getElementById('toolbar');
const buildToast=document.getElementById('buildToast');
// ===== Fixed UI size + auto scale =====
let __uiScale = 1;
let __lastStableUIScale = 1;
let __lastStableStageLeft = 0;
let __lastStableStageTop = 0;
function syncAppViewportHeight(){
  const vv = window.visualViewport;
  const rawHeight = (vv && Number.isFinite(vv.height) && vv.height > 0) ? vv.height : window.innerHeight;
  if(!Number.isFinite(rawHeight) || rawHeight <= 0) return;
  document.documentElement.style.setProperty('--app-vh', `${Math.round(rawHeight)}px`);
}
function applyUIScale(){
  const rs = getComputedStyle(document.documentElement);
  const baseW = parseFloat(rs.getPropertyValue('--base-w')) || 2048;
  const baseH = parseFloat(rs.getPropertyValue('--base-h')) || 974;

  syncAppViewportHeight();

  // ピンチズーム中は visual viewport が細かく変動し、
  // stage位置/スケールの再計算で盤面が飛ぶことがある。
  // そのため zoom 中は最後の安定値を維持する。
  const vv = window.visualViewport;
  const vvScale = (vv && Number.isFinite(vv.scale) && vv.scale > 0) ? vv.scale : 1;
  const isPinchZooming = vvScale > 1.001;
  if(isPinchZooming){
    document.documentElement.style.setProperty('--ui-scale', String(__lastStableUIScale || 1));
    document.documentElement.style.setProperty('--stage-left', (__lastStableStageLeft || 0) + 'px');
    document.documentElement.style.setProperty('--stage-top', (__lastStableStageTop || 0) + 'px');
    return;
  }

  let w = document.documentElement.clientWidth || window.innerWidth || baseW;
  let h = document.documentElement.clientHeight || window.innerHeight || baseH;

  let s = Math.min(1, w/baseW, h/baseH);
  if(!isFinite(s) || s<=0) s = 1;
  __lastStableUIScale = s;

  __uiScale = s;
  document.documentElement.style.setProperty('--ui-scale', String(s));
  let stageLeft = Math.max(0, (w - baseW * s) / 2);
  let stageTop  = 0;
  __lastStableStageLeft = stageLeft;
  __lastStableStageTop = stageTop;

  document.documentElement.style.setProperty('--stage-left', stageLeft + 'px');
  document.documentElement.style.setProperty('--stage-top', stageTop + 'px');
}
// transform:scale() 下でもドラッグ座標がズレないよう、盤面座標に変換
function getPointerBoardPos(ev){
  const r = board.getBoundingClientRect();
  const sx = (r.width / board.clientWidth) || 1;
  const sy = (r.height / board.clientHeight) || 1;
  return { x: (ev.clientX - r.left) / sx, y: (ev.clientY - r.top) / sy };
}
applyUIScale();
window.addEventListener('resize', applyUIScale);
window.addEventListener('orientationchange', ()=>setTimeout(applyUIScale, 0));
window.addEventListener('pageshow', ()=>setTimeout(applyUIScale, 0));
if(window.visualViewport){
  window.visualViewport.addEventListener('resize', applyUIScale);
  window.visualViewport.addEventListener('scroll', applyUIScale);
}

const btnFlip=document.getElementById('btnFlip');
const btnRemove=document.getElementById('btnRemove'); // [patch]
const btnToFront=document.getElementById('btnToFront');
const btnToBack=document.getElementById('btnToBack');
const btnUndo=document.getElementById('btnUndo');
const btnSave=document.getElementById('btnSave');
const btnLoad=document.getElementById('btnLoad');
const btnOpenSpectator=document.getElementById('btnOpenSpectator');

const spectatorPickPanel=document.getElementById('spectatorPickPanel');
const spectatorPickImg=document.getElementById('spectatorPickImg');
const spectatorPickName=document.getElementById('spectatorPickName');

let lastViewerPickedId=null; // 山札サーチで最後に選択/解除したカード


// ===== Spectator (Discord共有) =====
const IS_SPECTATOR = new URLSearchParams(location.search).has('spectator');
if(IS_SPECTATOR) document.body.classList.add('spectator');


// ===== Coin Toss =====
let lastCoin = null;

function updateSpectatorBadge(){
  // 観戦(共有)ウィンドウでは #toolbar を非表示にしているため、
  // コイントスの結果はバッジに出して見える化する。
  try{
    if(!IS_SPECTATOR) return;
    const b=document.getElementById('spectatorBadge');
    if(!b) return;
    const coin  = lastCoin ? `🪙コイントス：${lastCoin}` : '🪙コイントス：-';
    b.textContent = `共有用（手札 / サーチ非表示）
${coin}`;
  }catch(e){}
}

function updateCoinUI(){
  try{
    if(btnCoin){
      btnCoin.textContent = lastCoin ? `🪙コイントス：${lastCoin}` : '🪙コイントス';
    }
  }catch(e){}
  updateSpectatorBadge();
}
function doCoinToss(){
  if(IS_SPECTATOR) return;
  lastCoin = (Math.random()<0.5) ? '表' : '裏';
  updateCoinUI();
  try{ if(typeof pushUndo==='function') pushUndo(); }catch(e){}
  try{ if(typeof scheduleSpectatorSyncFast==='function') scheduleSpectatorSyncFast(); }catch(e){}
}


let spectatorWin = null;
let spectatorSyncTimer = null;

// reveal sync cache (spectator): avoid flicker by skipping redundant rebuilds
let spectatorRevealOpen=false;
let spectatorRevealKey='';
let spectatorRevealLastTs=0;

function spectatorUrl(){
  const u = new URL(location.href);
  u.searchParams.set('spectator','1');
  return u.toString();
}

function openSpectatorWindow(){
  if(IS_SPECTATOR) return;
  const url = spectatorUrl();
  spectatorWin = window.open(url, 'GCardSpectator', 'popup,width=1280,height=720');
  if(!spectatorWin){ alert('ポップアップがブロックされました。ブラウザの許可をお願いします。'); return; }

  // なるべくリアルタイムに近く同期（ドラッグ中も追従させる）
  if(spectatorSyncTimer) clearInterval(spectatorSyncTimer);
  spectatorSyncTimer = setInterval(()=>{
    if(!spectatorWin || spectatorWin.closed){
      clearInterval(spectatorSyncTimer);
      spectatorSyncTimer = null;
      spectatorWin = null;
      return;
    }
    sendStateToSpectator();
  }, 200);

  // 初回即送信
  setTimeout(sendStateToSpectator, 200);
}

function sendStateToSpectator(){
  if(IS_SPECTATOR) return;
  if(!spectatorWin || spectatorWin.closed) return;
  try{
    const _st=lightState();_st.__boardW=board?board.clientWidth:0;_st.__boardH=board?board.clientHeight:0;spectatorWin.postMessage({type:'GCARD_SYNC', payload: JSON.stringify(_st), ts:Date.now()}, '*');
  }catch(e){}
  sendRevealToSpectator();
  sendViewerUiToSpectator();
  sendPickToSpectator();
}
function sendRevealToSpectator(){
  if(IS_SPECTATOR) return;
  if(!spectatorWin || spectatorWin.closed) return;
  try{
    spectatorWin.postMessage({type:'GCARD_REVEAL', pool: (Array.isArray(revealPool)?revealPool.slice():[]), open: revealIsOpen(), mode: (typeof revealMode!=='undefined'?revealMode:'reveal'), ts:Date.now()}, '*');
  }catch(e){}
}
function viewerIsOpen(){ try{ return viewer && !viewer.classList.contains('hidden'); }catch(e){ return false; } }

// 共有用UI: 捨て札一覧は表示してOK、山札一覧はNG
function sendViewerUiToSpectator(){
  if(IS_SPECTATOR) return;
  if(!spectatorWin || spectatorWin.closed) return;
  const open = viewerIsOpen();
  const mode = (typeof viewerMode!=='undefined') ? viewerMode : null;
  try{
    spectatorWin.postMessage({type:'GCARD_VIEWER', open, mode, ts:Date.now()}, '*');
  }catch(e){}
}

// 山札サーチ時：選択中のカードだけ観戦側に見せる
function sendPickToSpectator(){
  if(IS_SPECTATOR) return;
  if(!spectatorWin || spectatorWin.closed) return;
  const open = viewerIsOpen();
  let pick=null;
  try{
    if(open && viewerMode==='deck'){
      const ids=[...viewerSelection];
      const id=(lastViewerPickedId && viewerSelection.has(lastViewerPickedId)) ? lastViewerPickedId : (ids[0]||null);
      if(id){
        const c=state.cards[id];
        if(c) pick={id, name:(c.name||c.id||id), front:(c.front||currentSrc(c))};
        else pick={id, name:id, front:null};
      }
    }
  }catch(e){}
  try{
    spectatorWin.postMessage({type:'GCARD_PICK', open, mode:(typeof viewerMode!=='undefined'?viewerMode:null), pick, ts:Date.now()}, '*');
  }catch(e){}
}

let spectatorFastLast=0;
function scheduleSpectatorSyncFast(){
  if(IS_SPECTATOR) return;
  if(!spectatorWin || spectatorWin.closed) return;
  const now = performance.now();
  if(now - spectatorFastLast < 50) return; // 約20fpsで十分
  spectatorFastLast = now;
  sendStateToSpectator();
}


// spectator側：openerに同期要求 + 同期受信
if(IS_SPECTATOR){
  window.addEventListener('message',(ev)=>{
    const d = ev.data;
    if(!d || typeof d!=='object') return;

    if(d.type==='GCARD_SYNC' && typeof d.payload==='string'){
      let __meta=null;
      try{
        const __p=JSON.parse(d.payload);
        if(__p && typeof __p.__boardW==='number' && typeof __p.__boardH==='number'){
          __meta={w:__p.__boardW,h:__p.__boardH};
        }
      }catch(e){}
      try{ loadFromJSON(d.payload, false); }catch(e){}
      // 共有側で「重なり」表示中なら内容も追従更新
      try{ if(stackModal && !stackModal.classList.contains('hidden')) buildStackList(); }catch(e){}
      // メイン画面と観戦画面で board サイズが違うと座標がズレるので、比率で補正
      try{
        if(__meta && __meta.w>0 && __meta.h>0 && board){
          const __sw=board.clientWidth, __sh=board.clientHeight;
          const __rx=__sw/__meta.w, __ry=__sh/__meta.h;
          if(isFinite(__rx)&&isFinite(__ry)&&__rx>0&&__ry>0){
            Object.values(state.cards).forEach(c=>{
              if(typeof c.x==='number') c.x=c.x*__rx;
              if(typeof c.y==='number') c.y=c.y*__ry;
            });
            state.order.forEach(id=>{
              const c=state.cards[id];
              const el=document.getElementById(id);
              if(!el||!c) return;
              el.style.left=c.x+'px';
              el.style.top=c.y+'px';
              el.style.transform=`scale(${c.scale}) rotate(${c.rot}deg)`;
            });
          }
        }
      }catch(e){}
      // 捨て札一覧を表示中なら、内容も追従更新
      try{
        if(document.body.classList.contains('showDiscardViewer')){
          viewerMode='discard';
          if(viewer) viewer.classList.remove('hidden');
          if(viewerTitle) viewerTitle.textContent='捨て札（公開）';
          buildViewerGrid();
        }
      }catch(e){}
    }

    if(d.type==='GCARD_VIEWER'){
      try{
        const open=!!d.open;
        const mode=d.mode;
        if(open && mode==='discard'){
          document.body.classList.add('showDiscardViewer');
          viewerMode='discard';
          if(viewerTitle) viewerTitle.textContent='捨て札（公開）';
          if(viewerSearchInput) viewerSearchInput.value='';
          if(viewer) viewer.classList.remove('hidden');
          buildViewerGrid();
        }else{
          document.body.classList.remove('showDiscardViewer');
          if(viewer) viewer.classList.add('hidden');
        }
      }catch(e){}
    }

    if(d.type==='GCARD_PICK'){
      try{
        const open=!!d.open;
        const mode=d.mode;
        const pick=d.pick;
        if(open && mode==='deck' && pick && pick.front){
          if(spectatorPickImg) spectatorPickImg.src=pick.front;
          if(spectatorPickName) spectatorPickName.textContent=pick.name||pick.id||'';
          if(spectatorPickPanel) spectatorPickPanel.classList.remove('hidden');
        }else{
          if(spectatorPickPanel) spectatorPickPanel.classList.add('hidden');
          if(spectatorPickImg) spectatorPickImg.removeAttribute('src');
          if(spectatorPickName) spectatorPickName.textContent='';
        }
      }catch(e){}
    }

    if(d.type==='GCARD_REVEAL'){
      try{        // 公開(reveal)は表表示、見る(peek)は裏面表示（手札と同様に自分だけ見える想定）
        const ts = (typeof d.ts==='number') ? d.ts : 0;
        if(ts && ts<=spectatorRevealLastTs) return;
        if(ts) spectatorRevealLastTs = ts;

        const open = !!d.open;
        const pool = Array.isArray(d.pool) ? d.pool.slice() : [];
        const mode = (d.mode==='peek') ? 'peek' : 'reveal';
        try{ revealMode = mode; }catch(e){}
        const key = mode + '|' + pool.join('|');

        // close or empty
        if(!open || pool.length===0){
          if(spectatorRevealOpen){
            spectatorRevealOpen=false;
            spectatorRevealKey='';
            if(revealSelection && revealSelection.clear) revealSelection.clear();
            closeRevealModal();
          }
          revealPool=[];
          revealOriginal=[];
          revealMode='reveal';
          return;
        }

        // open + has cards
        if(!spectatorRevealOpen){
          spectatorRevealOpen=true;
          spectatorRevealKey=key;
          revealPool=pool;
          revealOriginal=pool.slice();
          if(revealSelection && revealSelection.clear) revealSelection.clear();
          // 共有画面は頻繁な再描画でチラつくので、最初だけ開く（フォーカスしない）
          showRevealModal(true);
          return;
        }

        // already open: rebuild only when order/content changed
        if(key!==spectatorRevealKey){
          spectatorRevealKey=key;
          revealPool=pool;
          revealOriginal=pool.slice();
          if(revealSelection && revealSelection.clear) revealSelection.clear();
          buildRevealList();
        }
      }catch(e){}
    }
  });
  try{
    if(window.opener) window.opener.postMessage({type:'GCARD_REQ_SYNC'}, '*');
  }catch(e){}
}

// main側：同期要求が来たら送る
window.addEventListener('message',(ev)=>{
  const d = ev.data;
  if(!d || typeof d!=='object') return;
  if(d.type==='GCARD_REQ_SYNC') sendStateToSpectator();
});

const btnTurnStart=document.getElementById('btnTurnStart');
const btnPreview=document.getElementById('btnPreview');
const btnBackToMode=document.getElementById('btnBackToMode');
const btnToken=document.getElementById('btnToken');
const btnCounter=document.getElementById('btnCounter');
const btnCoin=document.getElementById('btnCoin');
const btnToolbarCollapse=document.getElementById('btnToolbarCollapse');
const deckReturnPosSel=document.getElementById('deckReturnPos'); // [patch]
let deckReturnPos=deckReturnPosSel?deckReturnPosSel.value:'top'; // [patch]
if(deckReturnPosSel){deckReturnPosSel.onchange=()=>{deckReturnPos=deckReturnPosSel.value;};}

function setToolbarCollapsed(collapsed){
  if(!toolbar) return;
  const isCollapsed = !!collapsed;
  toolbar.classList.toggle('collapsed', isCollapsed);
  if(btnToolbarCollapse){
    btnToolbarCollapse.setAttribute('aria-expanded', (!isCollapsed).toString());
    btnToolbarCollapse.textContent = isCollapsed ? '▸ ツールバー' : '▾ ツールバー';
  }
  try{ localStorage.setItem('toolbarCollapsed', isCollapsed ? '1' : '0'); }catch(e){}
}
function loadToolbarCollapsed(){
  let collapsed = false;
  try{ collapsed = localStorage.getItem('toolbarCollapsed') === '1'; }catch(e){}
  setToolbarCollapsed(collapsed);
}
if(btnToolbarCollapse){
  btnToolbarCollapse.addEventListener('click', ()=>{
    setToolbarCollapsed(!toolbar.classList.contains('collapsed'));
  });
}
loadToolbarCollapsed();

// start modal
const startModal=document.getElementById('startModal');
const btnStartBuild=document.getElementById('btnStartBuild');
const btnStartPlay=document.getElementById('btnStartPlay');
const btnStartTools=document.getElementById('btnStartTools');
const startVersion=document.getElementById('startVersion');
const toolsModal=document.getElementById('toolsModal');
const btnToolsBack=document.getElementById('btnToolsBack');
const btnToolThreatCalc=document.getElementById('btnToolThreatCalc');
const btnToolAreaCounter=document.getElementById('btnToolAreaCounter');
const threatCalcModal=document.getElementById('threatCalcModal');
const btnThreatCalcClose=document.getElementById('btnThreatCalcClose');
const areaCounterModal=document.getElementById('areaCounterModal');
const btnAreaCounterClose=document.getElementById('btnAreaCounterClose');
const btnAreaCounterClosePortrait=document.getElementById('btnAreaCounterClosePortrait');
const btnAreaCounterFlip=document.getElementById('btnAreaCounterFlip');
const acLeftNumberCircle=document.getElementById('acLeftNumberCircle');
const acRightNumberCircle=document.getElementById('acRightNumberCircle');
const acNumberPicker=document.getElementById('acNumberPicker');

// apply flip layout class (for embed opponent board etc.)
try{ if(FLIP_LAYOUT) document.body.classList.add('flipLayout'); }catch(e){}


// builder
const builder=document.getElementById('builder');
const builderMain=document.getElementById('builderMain');
const mobileBuilderTabs=document.getElementById('mobileBuilderTabs');
const btnMobileShowLib=document.getElementById('btnMobileShowLib');
const btnMobileShowDeck=document.getElementById('btnMobileShowDeck');
const libFilter=document.getElementById('libFilter');
const libColor=document.getElementById('libColor');
const libType=document.getElementById('libType');
const libGrade=document.getElementById('libGrade');
// ===== libGrade options (auto from meta) =====
function rebuildLibGradeOptions(){
  try{
    if(!libGrade) return;
    const prev = libGrade.value || '';
    const grades = new Set();

    // Collect unique grade values from CARD_META (via getMetaById)
    if(typeof CARD_DB!=='undefined' && Array.isArray(CARD_DB)){
      CARD_DB.forEach(c=>{
        const m = (typeof getMetaById==='function') ? getMetaById(c.id) : (c && c.meta ? c.meta : null);
        if(!m) return;
        const g = m.grade;
        if(g===undefined || g===null || g==='') return;
        grades.add(String(g).trim());
      });
    }

    let arr = Array.from(grades).filter(Boolean);

    // Fallback (in case meta is missing): show 1..8
    if(arr.length===0){
      arr = Array.from({length:8}, (_,i)=>String(i+1));
    }

    // Sort: numbers asc, then others
    arr.sort((a,b)=>{
      const aNum = /^[0-9]+$/.test(a);
      const bNum = /^[0-9]+$/.test(b);
      if(aNum && bNum) return Number(a)-Number(b);
      if(aNum) return -1;
      if(bNum) return 1;
      return a.localeCompare(b,'ja');
    });

    const esc = (v)=>String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

    libGrade.innerHTML = '<option value="">等級:すべて</option>' + arr.map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join('');

    if(prev && arr.includes(prev)) libGrade.value = prev;
  }catch(e){}
}
rebuildLibGradeOptions();
const libSetBar=document.getElementById('libSetBar');
const libSetSection=document.getElementById('libSetSection');
const libSetHeader=document.getElementById('libSetHeader');
const btnLibSetToggle=document.getElementById('btnLibSetToggle');
const libSetCurrent=document.getElementById('libSetCurrent');
const libList=document.getElementById('libList');
const gridMonster=document.getElementById('gridMonster');
const gridMain=document.getElementById('gridMain');
const countInfo=document.getElementById('countInfo');
const deckCodeBox=document.getElementById('deckCodeBox');
const btnCodeLoad=document.getElementById('btnCodeLoad');
const btnCodeGen=document.getElementById('btnCodeGen');
const btnBuildStart=document.getElementById('btnBuildStart');
const btnBuildSolo=document.getElementById('btnBuildSolo');
const btnBuildCancel=document.getElementById('btnBuildCancel');
const builderFooter=document.getElementById('builderFooter');
const builderFooterHeader=document.getElementById('builderFooterHeader');
const btnBuilderFooterToggle=document.getElementById('btnBuilderFooterToggle');

const btnQrGen=document.getElementById('btnQrGen');
const btnQrFile=document.getElementById('btnQrFile');
const qrFileInput=document.getElementById('qrFileInput');
const qrModal=document.getElementById('qrModal');
const qrPanel=document.getElementById('qrPanel');
const qrCanvas=document.getElementById('qrCanvas');
const qrText=document.getElementById('qrText');
const btnQrClose=document.getElementById('btnQrClose');
const btnQrCopy=document.getElementById('btnQrCopy');
// deck saves (builder)
const btnDeckSave=document.getElementById('btnDeckSave');
const btnDeckLoad=document.getElementById('btnDeckLoad');
const btnDeckReset=document.getElementById('btnDeckReset');
const btnDeckDownload=document.getElementById('btnDeckDownload');
const deckUploadInput=document.getElementById('deckUploadInput');
const deckMgr=document.getElementById('deckMgr');

// solo modal & container
const soloDeckModal=document.getElementById('soloDeckModal');
const soloDeckList=document.getElementById('soloDeckList');
const soloDeckSearch=document.getElementById('soloDeckSearch');
const soloStepText=document.getElementById('soloStepText');
const soloPickedInfo=document.getElementById('soloPickedInfo');
const btnSoloClose=document.getElementById('btnSoloClose');
const btnSoloBack=document.getElementById('btnSoloBack');
const btnSoloStart=document.getElementById('btnSoloStart');
const soloContainer=document.getElementById('soloContainer');
const soloScroll=document.getElementById('soloScroll');
const soloFrameOpp=document.getElementById('soloFrameOpp');
const soloFrameYou=document.getElementById('soloFrameYou');
const btnSoloExit=document.getElementById('btnSoloExit');

const deckMgrSearch=document.getElementById('deckMgrSearch');
const deckMgrList=document.getElementById('deckMgrList');
const deckMgrCount=document.getElementById('deckMgrCount');
const btnDeckMgrClose=document.getElementById('btnDeckMgrClose');
const btnDeckMgrDownload=document.getElementById('btnDeckMgrDownload');


// stack (area overlap)
const stackModal=document.getElementById('stack');
const stackTitle=document.getElementById('stackTitle');
const stackList=document.getElementById('stackList');
const btnStackClose=document.getElementById('btnStackClose');
const btnStackMoveAll=document.getElementById('btnStackMoveAll');
const stackDropChooser=document.getElementById('stackDropChooser');
const stackDropChooserTitle=document.getElementById('stackDropChooserTitle');
const btnStackDropTop=document.getElementById('btnStackDropTop');
const btnStackDropSecondTop=document.getElementById('btnStackDropSecondTop');
const btnStackDropBottom=document.getElementById('btnStackDropBottom');
let stackZoneId=null;
let stackSelectedId=null;

// reveal (deck top 공개)
const revealModal=document.getElementById('reveal');
const revealTitle=document.getElementById('revealTitle');
const revealList=document.getElementById('revealList');
const btnRevealSelectAll=document.getElementById('btnRevealSelectAll');
const btnRevealToHand=document.getElementById('btnRevealToHand');
const btnRevealToDiscard=document.getElementById('btnRevealToDiscard');
const btnRevealReturn=document.getElementById('btnRevealReturn');
const btnRevealCancel=document.getElementById('btnRevealCancel');
let revealPool=[];
let revealOriginal=[];
let revealSelection=new Set();
let revealTxnSnap=null;
let revealUndoMark=null;
let revealMode='reveal';// 'reveal' or 'peek'


// ===== stack / overlap manager =====
function closeStack(){stackModal.classList.add('hidden');stackZoneId=null;stackSelectedId=null;}
btnStackClose.onclick=closeStack;
btnStackMoveAll.onclick=()=>{
  if(!stackZoneId) return;
  const ids=getZoneCardIds(stackZoneId);
  if(!ids.length) return;
  selection.clear();
  ids.forEach(id=>selection.add(id));
  updateSelectionVisual();
  // すぐドラッグできるように閉じる
  closeStack();
  try{
    const z=zones.find(z=>z.id===stackZoneId);
    const nm=z?z.name:String(stackZoneId||'');
    window.logAction && window.logAction(`束を選択：${nm}（${ids.length}枚）`);
  }catch(e){}
};
stackModal.addEventListener('click',e=>{ if(e.target===stackModal) closeStack(); });
stackModal.addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();closeStack();}
});

function shouldAskStackDrop(cardId, zoneId){
  if(!zoneId || zoneId==='hand' || zoneId==='deckMain' || zoneId==='discard' || zoneId==='monster') return false;
  return state.order.some(id=>id!==cardId && state.cards[id] && state.cards[id].zone===zoneId);
}
function chooseStackDropPos(zoneId){
  return new Promise((resolve)=>{
    if(!stackDropChooser){ resolve('top'); return; }
    const z=zones.find(z=>z.id===zoneId);
    if(stackDropChooserTitle){
      stackDropChooserTitle.textContent = z ? `「${z.name}」に重ねる位置を選択` : '重ねる位置を選択';
    }
    const done=(v)=>{
      stackDropChooser.classList.add('hidden');
      cleanup();
      resolve(v || 'top');
    };
    const onKey=(e)=>{ if(e.key==='Escape'){ e.preventDefault(); done('top'); } };
    const onTop=()=>done('top');
    const onSecond=()=>done('secondTop');
    const onBottom=()=>done('bottom');
    const onBackdrop=(e)=>{ if(e.target===stackDropChooser) done('top'); };
    const cleanup=()=>{
      document.removeEventListener('keydown', onKey, true);
      stackDropChooser.removeEventListener('click', onBackdrop);
      btnStackDropTop && btnStackDropTop.removeEventListener('click', onTop);
      btnStackDropSecondTop && btnStackDropSecondTop.removeEventListener('click', onSecond);
      btnStackDropBottom && btnStackDropBottom.removeEventListener('click', onBottom);
    };
    btnStackDropTop && btnStackDropTop.addEventListener('click', onTop);
    btnStackDropSecondTop && btnStackDropSecondTop.addEventListener('click', onSecond);
    btnStackDropBottom && btnStackDropBottom.addEventListener('click', onBottom);
    stackDropChooser.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey, true);
    stackDropChooser.classList.remove('hidden');
  });
}

function getZoneCardIds(zoneId){
  // state.order の順（奥→手前）で返す
  return state.order.filter(id=>state.cards[id] && state.cards[id].zone===zoneId);
}
function syncOrderToDOM(){
  // state.order の順にDOM並びも揃える（見た目の重なり順に効く）
  state.order.forEach(id=>{
    const el=document.getElementById(id);
    if(el) board.appendChild(el);
    const ov=document.getElementById(id+'_ctr');
    if(ov) board.appendChild(ov);
  });
}
function applyZoneOrder(zoneId,newZoneIds){
  const set=new Set(newZoneIds);
  let p=0;
  state.order = state.order.map(id=> set.has(id) ? newZoneIds[p++] : id);
  syncOrderToDOM();
}

function openStack(zoneId){
  stackZoneId=zoneId;
  stackSelectedId=null;
  const z=zones.find(z=>z.id===zoneId);
  stackTitle.textContent = z ? `エリア${z.name}：重なり` : '重なり';
  buildStackList();
  stackModal.classList.remove('hidden');
  // フォーカスしてEscを拾う
  stackModal.tabIndex = -1;
  stackModal.focus();
}

function selectStackRow(cardId){
  stackSelectedId=cardId;
  // 盤面の選択も連動
  selection.clear();selection.add(cardId);updateSelectionVisual();
  // 行のハイライト
  stackList.querySelectorAll('.stackRow').forEach(r=>r.classList.toggle('selected',r.dataset.id===cardId));
}

function moveInStack(cardId,delta){
  if(!stackZoneId) return;
  const ids=getZoneCardIds(stackZoneId); // 奥→手前
  const idx=ids.indexOf(cardId);
  if(idx===-1) return;
  const to=Math.max(0,Math.min(ids.length-1,idx+delta));
  if(to===idx) return;
  ids.splice(idx,1);
  ids.splice(to,0,cardId);
  applyZoneOrder(stackZoneId,ids);
  buildStackList();
  selectStackRow(cardId);
  if(typeof pushUndoDebounced==='function') pushUndoDebounced();
  else pushUndo();
}

function moveToEdge(cardId,toFront){
  if(!stackZoneId) return;
  const ids=getZoneCardIds(stackZoneId); // 奥→手前
  const idx=ids.indexOf(cardId);
  if(idx===-1) return;
  ids.splice(idx,1);
  if(toFront) ids.push(cardId); else ids.unshift(cardId);
  applyZoneOrder(stackZoneId,ids);
  buildStackList();
  selectStackRow(cardId);
  if(typeof pushUndoDebounced==='function') pushUndoDebounced();
  else pushUndo();
}

function buildStackList(){
  stackList.innerHTML='';
  if(!stackZoneId) return;
  const ids=getZoneCardIds(stackZoneId); // 奥→手前
  if(!ids.length){
    const p=document.createElement('div');
    p.style.opacity='.8';
    p.textContent='（このエリアにはカードがありません）';
    stackList.appendChild(p);
    return;
  }

  // 表示は「手前→奥」にして直感的に
  const display=ids.slice().reverse(); // 手前→奥
  display.forEach((id,dispIndex)=>{
    const c=state.cards[id];
    const row=document.createElement('div');
    row.className='stackRow';
    row.dataset.id=id;

    const thumb=document.createElement('div');thumb.className='stackThumb';
    const img=document.createElement('img');
    const mask = (IS_SPECTATOR && !!c.faceDown);
    const b = backSrc || WHITE_BACK;
    img.src = mask ? b : (c.front || WHITE_BACK); // 裏でも中身確認できるように front を表示（共有は裏に）
    img.onerror=()=>{img.src = mask ? b : WHITE_BACK;};
    thumb.appendChild(img);
    if(c.faceDown){
      const badge=document.createElement('div');badge.className='stackBadge';badge.textContent='裏';
      thumb.appendChild(badge);
    }

    const info=document.createElement('div');info.className='stackInfo';
    const name=document.createElement('div');name.className='stackName';name.textContent=c.origName || '';
    const meta=document.createElement('div');meta.className='stackMeta';
    meta.textContent = (dispIndex===0?'手前（最上）':(dispIndex===display.length-1?'奥（最下）':''));
    info.append(name,meta);

    const ctrl=document.createElement('div');ctrl.className='stackCtrl';
    const btnFront=document.createElement('button');btnFront.textContent='手前へ';
    const btnBack=document.createElement('button');btnBack.textContent='奥へ';
    const btnTop=document.createElement('button');btnTop.textContent='最前';
    const btnBottom=document.createElement('button');btnBottom.textContent='最奥';

    // display は 手前→奥。state order(ids) は 奥→手前 なので、手前へ = +1 / 奥へ = -1
    btnFront.onclick=(e)=>{e.stopPropagation();moveInStack(id,+1);};
    btnBack.onclick=(e)=>{e.stopPropagation();moveInStack(id,-1);};
    btnTop.onclick=(e)=>{e.stopPropagation();moveToEdge(id,true);};
    btnBottom.onclick=(e)=>{e.stopPropagation();moveToEdge(id,false);};

    ctrl.append(btnFront,btnBack,btnTop,btnBottom);

    row.append(thumb,info,ctrl);
    row.onclick=()=>selectStackRow(id);

    // 初期で一番手前を選択
    stackList.appendChild(row);
  });

  if(!stackSelectedId){
    const first=display[0];
    if(first) selectStackRow(first);
  }else{
    // まだ存在してるなら選択維持
    if(display.includes(stackSelectedId)) selectStackRow(stackSelectedId);
    else stackSelectedId=null;
  }
}

// ===== reveal (deck top 공개) =====
function revealIsOpen(){ return revealModal && !revealModal.classList.contains('hidden'); }

function showRevealModal(skipFocus=false){
  if(!revealModal) return;
  buildRevealList();
  revealModal.classList.remove('hidden');
  if(!skipFocus){
    revealModal.tabIndex = -1;
    revealModal.focus();
  }
}
function closeRevealModal(){
  if(!revealModal) return;
  revealModal.classList.add('hidden');
  revealSelection.clear();
}

function openRevealPrompt(){
  if(revealIsOpen()){ alert('すでに公開中です'); return; }
  if(deckPool.length===0){ alert('山札がありません'); return; }
  const raw = prompt('山札の上から何枚公開しますか？', '1');
  if(raw==null) return;
  let n = parseInt(String(raw).trim(),10);
  if(!Number.isFinite(n) || n<=0){ alert('枚数が不正です'); return; }
  n = Math.min(n, deckPool.length);
  startReveal(n,'reveal');
}

function openPeekPrompt(){
  if(revealIsOpen()){ alert('すでに表示中です'); return; }
  if(deckPool.length===0){ alert('山札がありません'); return; }
  const raw = prompt('山札の上から何枚見ますか？（共有用ウィンドウでは裏面表示）', '1');
  if(raw==null) return;
  let n = parseInt(String(raw).trim(),10);
  if(!Number.isFinite(n) || n<=0){ alert('枚数が不正です'); return; }
  n = Math.min(n, deckPool.length);
  startReveal(n,'peek');
}

function startReveal(n,mode){
  revealMode = (mode==='peek') ? 'peek' : 'reveal';
  // すでに公開中なら無視
  if(revealPool.length){ showRevealModal(); return; }

  // 公開は「トランザクション」扱い：キャンセル時は開始前へロールバックする
  revealUndoMark = state.undoStack.length;
  try{ revealTxnSnap = JSON.stringify(lightState()); }catch(e){ revealTxnSnap = null; }

  revealPool = deckPool.splice(0, n); // 山札の上から取り出す
  revealOriginal = revealPool.slice(); // キャンセル用
  revealSelection.clear();
  updateCounters();
  showRevealModal();
  sendRevealToSpectator();
}

function buildRevealList(){
  if(!revealList) return;
  revealList.innerHTML='';
  // タイトル
  if(revealTitle){
    const label = (revealMode==='peek') ? '見る' : '公開';
    revealTitle.textContent = `山札 ${label}（${revealPool.length}枚）`;
  }
  if(!revealPool.length){
    const p=document.createElement('div');
    p.style.opacity='.8';
    p.textContent='（公開中のカードはありません）';
    revealList.appendChild(p);
    return;
  }





  const maskReveal = (IS_SPECTATOR && revealMode==='peek');
  const revealBack = backSrc || WHITE_BACK;


  revealPool.forEach((id,idx)=>{
    const c=state.cards[id];
    const row=document.createElement('div');
    row.className='revealRow';
    row.dataset.id=id;
    row.classList.toggle('selected', revealSelection.has(id));

    const thumb=document.createElement('div');
    thumb.className='revealThumb';
    const img=document.createElement('img');
    img.src = maskReveal ? revealBack : c.front;
    img.onerror=()=>{img.src = maskReveal ? revealBack : WHITE_BACK;};
    thumb.appendChild(img);

    const info=document.createElement('div');
    info.className='revealInfo';
    const name=document.createElement('div');
    name.className='revealName';
    name.textContent = maskReveal ? '（非公開）' : (c.origName||'');
    const meta=document.createElement('div');
    meta.className='revealMeta';
    meta.textContent = (idx===0?'上（1枚目）':`上から${idx+1}枚目`);
    info.append(name,meta);

    const ctrl=document.createElement('div');
    ctrl.className='revealCtrl';
    const up=document.createElement('button');up.textContent='▲';
    const down=document.createElement('button');down.textContent='▼';
    up.disabled = (IS_SPECTATOR || idx===0);
    down.disabled = (IS_SPECTATOR || idx===revealPool.length-1);
    if(!IS_SPECTATOR) up.onclick=(e)=>{e.stopPropagation();moveReveal(id,-1);};
    if(!IS_SPECTATOR) down.onclick=(e)=>{e.stopPropagation();moveReveal(id,+1);};

    ctrl.append(up,down);

    row.append(thumb,info,ctrl);
    if(!IS_SPECTATOR) row.onclick=()=>toggleRevealSelect(id);

    revealList.appendChild(row);
  });
}

function toggleRevealSelect(id){
  if(revealSelection.has(id)) revealSelection.delete(id);
  else revealSelection.add(id);
  // 反映
  revealList.querySelectorAll('.revealRow').forEach(r=>{
    r.classList.toggle('selected', revealSelection.has(r.dataset.id));
  });
}

function moveReveal(id,delta){
  const idx=revealPool.indexOf(id);
  if(idx===-1) return;
  const to=Math.max(0, Math.min(revealPool.length-1, idx+delta));
  if(to===idx) return;
  revealPool.splice(idx,1);
  revealPool.splice(to,0,id);
  buildRevealList();
  sendRevealToSpectator();
}

function toggleRevealSelectAll(){
  const doSel = revealSelection.size !== revealPool.length;
  revealSelection.clear();
  if(doSel) revealPool.forEach(id=>revealSelection.add(id));
  buildRevealList();
}

function revealMoveSelectedToHand(){
  if(!revealSelection.size){ alert('カードを選択してください'); return; }
  const ids = revealPool.filter(id=>revealSelection.has(id));
  ids.forEach(id=>{
    // 公開リストから除外
    const i=revealPool.indexOf(id); if(i!==-1) revealPool.splice(i,1);
    const c=state.cards[id];
    c.zone='hand';
    c.faceDown=false;
    placeInHand(c);
    bringToFront(id);
    renderCard(c);
  });
  revealSelection.clear();
  updateCounters();
  pushUndo();
  buildRevealList();
}

function revealMoveSelectedToDiscard(){
  if(!revealSelection.size){ alert('カードを選択してください'); return; }
  const ids = revealPool.filter(id=>revealSelection.has(id));
  ids.forEach(id=>{
    const i=revealPool.indexOf(id); if(i!==-1) revealPool.splice(i,1);
    const c=state.cards[id];
    c.zone='discard';
    c.faceDown=true;
    hideIfPooled(c);
    if(!discardPool.includes(id)) discardPool.push(id);
    renderCard(c);
  });
  revealSelection.clear();
  updateCounters();
  pushUndo();
  buildRevealList();
}

function cleanupRevealTxn(){
  revealPool=[];
  revealOriginal=[];
  revealSelection.clear();
  revealTxnSnap=null;
  revealUndoMark=null;
}

function returnRevealToDeck(){
  if(!revealPool.length){ cleanupRevealTxn(); closeRevealModal(); return; }

  const order = revealPool.slice(); // 現在の並び（order[0]が一番上）
  deckPool = order.concat(deckPool);

  order.forEach(id=>{
    const c=state.cards[id];
    c.zone='deckMain';
    c.faceDown=true;
    hideIfPooled(c);
    renderCard(c);
  });

  cleanupRevealTxn();
  updateCounters();
  pushUndo();
  closeRevealModal();
  sendRevealToSpectator();
}

function cancelReveal(){
  // 公開中に積まれたUndoは破棄（公開開始前まで戻す）
  if(typeof revealUndoMark==='number' && state.undoStack){
    if(state.undoStack.length>revealUndoMark) state.undoStack.length=revealUndoMark;
  }

  if(revealTxnSnap){
    // 開始前スナップへロールバック（pushしない）
    loadFromJSON(revealTxnSnap,false);
  }else{
    // フォールバック：公開カードを元の順で戻す
    if(revealPool.length){
      const order = (revealOriginal && revealOriginal.length) ? revealOriginal.slice() : revealPool.slice();
      deckPool = order.concat(deckPool);
      order.forEach(id=>{
        const c=state.cards[id];
        c.zone='deckMain';
        c.faceDown=true;
        hideIfPooled(c);
        renderCard(c);
      });
    }
    updateCounters();
  }

  cleanupRevealTxn();
  closeRevealModal();
  sendRevealToSpectator();
}

// reveal modal handlers
if(btnRevealSelectAll) btnRevealSelectAll.onclick=toggleRevealSelectAll;
if(btnRevealToHand) btnRevealToHand.onclick=revealMoveSelectedToHand;
if(btnRevealToDiscard) btnRevealToDiscard.onclick=revealMoveSelectedToDiscard;
if(btnRevealReturn) btnRevealReturn.onclick=returnRevealToDeck;
if(btnRevealCancel) btnRevealCancel.onclick=cancelReveal;

if(revealModal){
  revealModal.addEventListener('click',e=>{ if(e.target===revealModal) cancelReveal(); });
  revealModal.addEventListener('keydown',e=>{
    if(e.key==='Escape'){ e.preventDefault(); cancelReveal(); }
  });
}




// viewer
const viewer=document.getElementById('viewer');
const viewerGrid=document.getElementById('viewerGrid');
const viewerSearchInput=document.getElementById('viewerSearch');
const viewerTitle=document.getElementById('viewerTitle');
const btnViewerToHand=document.getElementById('btnViewerToHand');
const btnViewerToDiscard=document.getElementById('btnViewerToDiscard');
const btnViewerCancel=document.getElementById('btnViewerCancel');
const btnViewerSelectAll=document.getElementById('btnViewerSelectAll');
let viewerMode='deck';let viewerSelection=new Set();

// preview
const preview=document.getElementById('preview');
const previewImg=document.getElementById('previewImg');
const previewClose=document.getElementById('previewClose');
// token selector refs
const tokenModal=document.getElementById('token');
const tokenGrid=document.getElementById('tokenGrid');
const tokenCountInput=document.getElementById('tokenCount');
const btnTokenCancel=document.getElementById('btnTokenCancel');
const btnTokenCreate=document.getElementById('btnTokenCreate');





// ===== COUNTER (＋補正) =====
const counterModal=document.getElementById('counter');
const counterGrid=document.getElementById('counterGrid');
const btnCounterCancel=document.getElementById('btnCounterCancel');
const btnCounterClear=document.getElementById('btnCounterClear');

const COUNTER_DEFS=[
  {val:1000,  label:'+1000',  src:`${CARD_FOLDER}/+1000.png`},
  {val:3000,  label:'+3000',  src:`${CARD_FOLDER}/+3000.png`},
  {val:5000,  label:'+5000',  src:`${CARD_FOLDER}/+5000.png`},
  {val:10000, label:'+10000', src:`${CARD_FOLDER}/+10000.png`},
];

function counterSrcByVal(v){
  v=Number(v)||0;
  const def=COUNTER_DEFS.find(d=>d.val===v);
  return def ? def.src : '';
}

function normalizeCounters(card){
  if(!card) return [];
  if(Array.isArray(card.counters)){
    return card.counters.map(n=>Number(n)||0).filter(n=>n);
  }
  const v=Number(card.counterVal)||0;
  return v ? [v] : [];
}
function getCounterSum(card){
  const arr=normalizeCounters(card);
  return arr.reduce((a,b)=>a+(Number(b)||0),0);
}

function openCounterSelector(){
  if(!counterModal) return;
  if(!selection || !selection.size){alert('カードを選択してください');return;}
  counterGrid.innerHTML='';
  COUNTER_DEFS.forEach(def=>{
    const w=document.createElement('div');
    w.className='counterThumb';
    const img=document.createElement('img');
    img.src=def.src;
    img.alt=def.label;
    w.appendChild(img);
    w.title=def.label;
    w.addEventListener('click',()=>{
      applyCounterToSelection(def.val);
      closeCounterSelector();
    });
    counterGrid.appendChild(w);
  });
  counterModal.classList.remove('hidden');
  counterModal.tabIndex=-1;
  counterModal.focus();
}
function closeCounterSelector(){
  if(!counterModal) return;
  counterModal.classList.add('hidden');
}

function applyCounterToSelection(val){
  if(!selection || !selection.size) return;
  const add = Number(val)||0;
  if(!add) return;
  selection.forEach(id=>{
    const c=state.cards[id];
    if(!c) return;
    c.counters = normalizeCounters(c);
    c.counters.push(add);
    c.counterVal = getCounterSum(c); // 互換用
    renderCard(c);
  });
  scheduleSpectatorSyncFast();
  if(typeof pushUndoDebounced==='function') pushUndoDebounced();
  else pushUndo();
}

function clearCounterOnSelection(){
  if(!selection || !selection.size){alert('カードを選択してください');return;}
  selection.forEach(id=>{
    const c=state.cards[id];
    if(!c) return;
    c.counters = [];
    c.counterVal = 0;
    renderCard(c);
  });
  scheduleSpectatorSyncFast();
  if(typeof pushUndoDebounced==='function') pushUndoDebounced();
  else pushUndo();
}

if(btnCounter) btnCounter.onclick=openCounterSelector;
if(btnCounterCancel) btnCounterCancel.onclick=closeCounterSelector;
if(btnCounterClear) btnCounterClear.onclick=()=>{ clearCounterOnSelection(); closeCounterSelector(); };

if(counterModal){
  counterModal.addEventListener('click',e=>{ if(e.target===counterModal) closeCounterSelector(); });
  counterModal.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();closeCounterSelector();}
    // quick apply while modal open
    if(['1','2','3','4'].includes(e.key)){
      e.preventDefault();
      const def=COUNTER_DEFS[Number(e.key)-1];
      if(def){ applyCounterToSelection(def.val); closeCounterSelector(); }
    }
  });
}

// ===== ZONES =====
const SLOT_W=0.11,SLOT_H=0.24;const X1=0.24,X2=0.37,X3=0.50,X4=0.63,X5=0.76;const Y_BOTTOM=0.58,Y_TOP=0.12;
const BASE_ZONES=[
  { id:'strategy1',name:'戦略カード置き場①',x:0.04,y:0.08,w:0.18,h:0.18 },
  { id:'strategy2',name:'戦略カード置き場②',x:0.04,y:0.31,w:0.18,h:0.18 },
  { id:'monster',name:'怪獣デッキ置き場',x:0.043,y:0.55,w:0.18,h:0.26 },
  { id:'rage',name:'怒りカード置き場',x:0.25,y:0.10,w:0.22,h:0.26 },
  { id:'slot8',name:'8',x:X3,y:Y_TOP,w:SLOT_W,h:SLOT_H },
  { id:'slot7',name:'7',x:X4,y:Y_TOP,w:SLOT_W,h:SLOT_H },
  { id:'slot6',name:'6',x:X5,y:Y_TOP,w:SLOT_W,h:SLOT_H },
  { id:'slot1',name:'1',x:X1,y:Y_BOTTOM,w:SLOT_W,h:SLOT_H },
  { id:'slot2',name:'2',x:X2,y:Y_BOTTOM,w:SLOT_W,h:SLOT_H },
  { id:'slot3',name:'3',x:X3,y:Y_BOTTOM,w:SLOT_W,h:SLOT_H },
  { id:'slot4',name:'4',x:X4,y:Y_BOTTOM,w:SLOT_W,h:SLOT_H },
  { id:'slot5',name:'5',x:X5,y:Y_BOTTOM,w:SLOT_W,h:SLOT_H },
  { id:'deckMain',name:'山札',x:0.885,y:0.12,w:0.095,h:0.26 },
  { id:'discard',name:'捨て札',x:0.885,y:0.40,w:0.095,h:0.18 },
  { id:'hand',name:'手札',x:0.18,y:0.84,w:0.64,h:0.14 }
];

function flipZone(z){return Object.assign({}, z, {x:1 - z.x - z.w, y:1 - z.y - z.h});}
const zones = (FLIP_LAYOUT ? BASE_ZONES.map(flipZone) : BASE_ZONES);
const zoneDom={};

function createZones(){
  const bw=board.clientWidth,bh=board.clientHeight;
  zones.forEach(z=>{
    const d=document.createElement('div');d.className='zone';d.dataset.zoneId=z.id;if(/^slot\d+$/.test(z.id))d.classList.add('slot-zone');
    d.style.left=(z.x*bw)+'px';d.style.top=(z.y*bh)+'px';d.style.width=(z.w*bw)+'px';d.style.height=(z.h*bh)+'px';
    const label=document.createElement('div');label.className='zone-label';label.textContent=z.name;d.appendChild(label);
    board.appendChild(d);zoneDom[z.id]=d;
  });
  const dz=zones.find(z=>z.id==='deckMain');deckCounterEl.style.left=(dz.x*bw+4)+'px';deckCounterEl.style.top=(dz.y*bh+4)+'px';
  const cz=zones.find(z=>z.id==='discard');discardCounterEl.style.left=(cz.x*bw+4)+'px';discardCounterEl.style.top=(cz.y*bh+4)+'px';
  const mz=zones.find(z=>z.id==='monster');monsterCounterEl.style.left=(mz.x*bw+4)+'px';monsterCounterEl.style.top=(mz.y*bh+4)+'px';
  buildZoneControls();buildAreaControls();
}

function buildZoneControls(){
  document.querySelectorAll('.zoneUI,.rageUI').forEach(e=>e.remove());
  if(IS_SPECTATOR){
    // 共有/観戦用：操作ボタンは出さないが、怒りカウンターだけは表示する
    const rageZ=zoneDom['rage'];
    if(rageZ){
      const ui=document.createElement('div');
      ui.className='rageUI';
      const span=document.createElement('span');
      span.id='rageCounter';
      span.textContent=rageCount;
      ui.appendChild(span);
      rageZ.appendChild(ui);
    }
    return;
  }

  const mk=t=>{const b=document.createElement('button');b.textContent=t;return b;};
  const deckZ=zoneDom['deckMain'];if(deckZ){const ui=document.createElement('div');ui.className='zoneUI';const s=mk('サーチ'),pk=mk('見る'),rv=mk('公開'),sh=mk('シャッフル'),d1=mk('1ドロー'),d5=mk('5ドロー');ui.append(s,pk,rv,sh,d1,d5);deckZ.appendChild(ui);s.onclick=()=>openViewer('deck');pk.onclick=()=>openPeekPrompt();rv.onclick=()=>openRevealPrompt();sh.onclick=()=>{shuffleDeck();pushUndo();};d1.onclick=()=>{drawFromDeck(1);pushUndo();};d5.onclick=()=>{drawFromDeck(5);pushUndo();};}
  const disZ=zoneDom['discard'];if(disZ){const ui=document.createElement('div');ui.className='zoneUI';const s=mk('サーチ'),bk=mk('山札へ戻す');ui.append(s,bk);disZ.appendChild(ui);s.onclick=()=>openViewer('discard');bk.onclick=()=>{if(discardToDeck()) pushUndo();};}
  const rageZ=zoneDom['rage'];if(rageZ){const ui=document.createElement('div');ui.className='rageUI';const span=document.createElement('span');span.id='rageCounter';span.textContent=rageCount;const wrap=document.createElement('div');wrap.className='rageBtns';const p=mk('怒り+'),m=mk('怒り-'),r=mk('リセット');wrap.append(p,m,r);ui.append(span,wrap);rageZ.appendChild(ui);p.onclick=()=>{rageCount++;updateRageDisplay();pushUndo();};m.onclick=()=>{rageCount=Math.max(0,rageCount-1);updateRageDisplay();pushUndo();};r.onclick=()=>{rageCount=0;updateRageDisplay();pushUndo();};}
}

function buildAreaControls(){
  document.querySelectorAll('.areaUI').forEach(e=>e.remove());
  const chain=['slot1','slot2','slot3','slot4','slot5','slot6','slot7','slot8'];
  const repel={slot6:'slot5',slot7:'slot4',slot8:'slot3'};

  chain.forEach(id=>{
    const dom=zoneDom[id];
    if(!dom) return;

    const ui=document.createElement('div');
    ui.className='areaUI';

    // 共有/観戦用でも「重なり」は表示させたい（閲覧専用）
    const s=document.createElement('button');
    s.textContent='重なり';
    ui.appendChild(s);
    s.onclick=()=>openStack(id);

    if(!IS_SPECTATOR){
      // 操作系ボタンはメイン画面のみ
      const f=document.createElement('button'); f.textContent='前進';
      const b=document.createElement('button'); b.textContent='後退';
      ui.insertBefore(f, s);
      ui.insertBefore(b, s);

      if(repel[id]){
        const r=document.createElement('button'); r.textContent='撃退';
        ui.appendChild(r);
        r.onclick=()=>{ moveZoneCards(id, repel[id]); pushUndo(); };
      }

      f.onclick=()=>{ const i=chain.indexOf(id); if(i!==-1 && i<chain.length-1){ moveZoneCards(id, chain[i+1]); pushUndo(); } };
      b.onclick=()=>{ const i=chain.indexOf(id); if(i>0){ moveZoneCards(id, chain[i-1]); pushUndo(); } };
    }

    dom.appendChild(ui);
  });
}

function moveZoneCards(fromId,toId){
  const zTo = zones.find(z=>z.id===toId);
  if(!zTo) return;

  // 統一配置：スナップと同じロジックで、移動先ゾーン内の位置を揃える（ランダム排除）
  const ids = state.order.filter(id => state.cards[id] && state.cards[id].zone===fromId);
  ids.forEach(id=>{
    const c = state.cards[id];
    c.zone = toId;
    snapCardToZone(c, zTo);
    hideIfPooled(c);
    renderCard(c);
  });
}

function updateRageDisplay(){const el=document.getElementById('rageCounter');if(el)el.textContent=rageCount;}

// ===== Play HUD (monster + total repel) =====
let __playHud=null,__mhImg=null,__mhName=null,__mhArea=null,__mhStack=null,__mhGrade=null,__mhRage=null,__mhThreat=null,__rhValue=null;
let __playHudTimer=null;

function __roman(n){
  const r=['','I','II','III','IV','V','VI','VII','VIII','IX','X'];
  n=Number(n)||0;
  return (n>=0 && n<r.length) ? r[n] : String(n||'-');
}
function __fmt(n){
  n=Number(n)||0;
  try{return n.toLocaleString('ja-JP');}catch(e){return String(n);}
}

function initPlayHud(){
  if(document.getElementById('playHud')) return;

  __playHud=document.createElement('div');
  __playHud.id='playHud';

  const monster=document.createElement('div');
  monster.id='monsterHud';
  monster.className='playHudPanel';
  monster.innerHTML = `
    <div class="mhTop">
      <div class="mhCard"><img id="mhImg" alt="monster"></div>
      <div class="mhMeta">
        <div class="mhName" id="mhName">怪獣：未配置</div>
        <div class="mhSub">
          <div class="mhSubLine"><span class="badge" id="mhArea">エリア -</span></div>
          <div class="mhSubLine"><span class="badge" id="mhStack">下に0枚</span></div>
        </div>
      </div>
    </div>
    <div class="mhStats">
      <div class="mhStat"><div class="mhLabel">等級</div><div class="mhValue" id="mhGrade">-</div></div>
      <div class="mhStat"><div class="mhLabel">怒り</div><div class="mhValue" id="mhRage">0</div></div>
      <div class="mhStat"><div class="mhLabel">脅威度</div><div class="mhValue" id="mhThreat">0</div></div>
    </div>
  `;

  const repel=document.createElement('div');
  repel.id='repelHud';
  repel.className='playHudPanel';
  repel.innerHTML = `
    <div class="rhRow">
      <div class="rhLabel">⚔ 撃退力合計</div>
      <div class="rhValue" id="rhTotal">0</div>
    </div>
    <div class="rhNote">（表向きの交戦カード / 素の撃退力）</div>
  `;

  __playHud.appendChild(monster);
  __playHud.appendChild(repel);
  board.appendChild(__playHud);
  // 初期配置
  positionPlayHud();

  __mhImg=monster.querySelector('#mhImg');
  __mhName=monster.querySelector('#mhName');
  __mhArea=monster.querySelector('#mhArea');
  __mhStack=monster.querySelector('#mhStack');
  __mhGrade=monster.querySelector('#mhGrade');
  __mhRage=monster.querySelector('#mhRage');
  __mhThreat=monster.querySelector('#mhThreat');
  __rhValue=repel.querySelector('#rhTotal');

  updatePlayHud();
  if(!__playHudTimer) __playHudTimer=setInterval(updatePlayHud, 250);
}


function positionPlayHud(){
  if(!__playHud) return;
  const bw=board.clientWidth, bh=board.clientHeight;

  const dz = zones.find(z=>z.id==='discard');
  if(!dz) return;

  // 捨て札ゾーンの「すぐ下」にHUDを配置（右端揃え）
  const topWanted = (dz.y + dz.h) * bh + 140;
  const rightWanted = (1 - (dz.x + dz.w)) * bw + -70;

  // 手札ゾーンに被らないようにクランプ
  const hz = zones.find(z=>z.id==='hand');
  const hudH = __playHud.offsetHeight || 0;
  let maxTop = topWanted;
  if(hz && hudH){
    maxTop = hz.y * bh - hudH + 100;
  }
  const top = Math.max(0, Math.min(topWanted, maxTop));

  __playHud.style.left = 'auto';
  __playHud.style.right = Math.round(Math.max(8, rightWanted)) + 'px';
  __playHud.style.top = Math.round(top) + 'px';
}

function __findTopMonsterOnBoard(){
  const slotZones=zones.filter(z=>/^slot\d+$/.test(z.id));
  for(const z of slotZones){
    const ids=getZoneCardIds(z.id);
    if(!ids.length) continue;
    const topId=ids[ids.length-1];
    const c=state.cards[topId];
    if(!c) continue;
    const meta=getMetaById(String((c.metaId||c.origName||'')).replace(/\.png$/i,''));
    if(meta && meta.type==='怪獣'){
      return {card:c,meta,zone:z};
    }
  }
  return null;
}

function __calcTotalRepel(){
  let total=0;
  const battleZones=zones.filter(z=>/^slot\d+$/.test(z.id));
  const strategyZones=zones.filter(z=>/^strategy\d+$/.test(z.id));

  // 交戦ゾーン：重なっている場合は「一番上の交戦カード」だけを参照（表向きのみ）
  for(const z of battleZones){
    const ids=getZoneCardIds(z.id);

    // 上（前面）から探して、最初に見つかった交戦カードだけを採用
    for(let i=ids.length-1;i>=0;i--){
      const id=ids[i];
      const c=state.cards[id];
      if(!c || c.faceDown) continue; // 表向きのみ

      const meta=getMetaById(String((c.metaId||c.origName||'')).replace(/\.png$/i,''));
      if(meta && meta.type==='交戦'){
        const v=Number(meta.power||0);
        if(Number.isFinite(v)) total+=v;

        const cv=getCounterSum(c);
        if(Number.isFinite(cv) && cv) total+=cv;

        break; // ←下の交戦カードは加算しない
      }
    }
  }

  // 戦略ゾーン：戦略置き場のカードのカウンターは撃退力に加算（怪獣は除外）
  for(const z of strategyZones){
    const ids=getZoneCardIds(z.id);
    for(const id of ids){
      const c=state.cards[id];
      if(!c) continue;
      const meta=getMetaById(String((c.metaId||c.origName||'')).replace(/\.png$/i,''));
      if(meta && meta.type==='怪獣') continue; // 念のため
      const cv=getCounterSum(c);
      if(Number.isFinite(cv) && cv) total+=cv;
    }
  }

  return total;
}

function updatePlayHud(){
  if(!__playHud) return;

  // ビルダー（デッキ構築UI）が開いている時はHUDを隠す
  try{
    if(typeof builder!=='undefined' && builder && !builder.classList.contains('hidden')){
      __playHud.style.display='none';
      return;
    }
  }catch(e){}
  __playHud.style.display='flex';

  const found=__findTopMonsterOnBoard();
  const rage=Number(rageCount)||0;

  if(found){
    const {card,meta,zone}=found;
    __mhImg.src=currentSrc(card);
    __mhName.textContent = meta.name || card.origName || '怪獣カード';
    __mhArea.textContent = zone ? `エリア ${zone.name}` : 'エリア -';
    // 怪獣カードの「下に重なっている枚数」を表示（同一エリア内での順序）
    try{
      const idsInZone = (zone && zone.id) ? getZoneCardIds(zone.id) : [];
      const idx = idsInZone.indexOf(card.id);
      const under = (idx>0) ? idx : 0;
      if(__mhStack) __mhStack.textContent = `下に${under}枚`;
    }catch(e){ if(__mhStack) __mhStack.textContent = '下に0枚'; }

    __mhGrade.textContent = meta.grade ? __roman(meta.grade) : '-';
    __mhRage.textContent = String(rage);

    // スプシの「脅威度/撃退力」列は、怪獣の場合は脅威度として扱う（素の数値）
    const baseThreat = Number(meta.power||0);
    const threat = (Number.isFinite(baseThreat)?baseThreat:0) + (rage*5000) + getCounterSum(card);
    __mhThreat.textContent = __fmt(threat);
  }else{
    __mhImg.src = (backSrc || WHITE_BACK);
    __mhName.textContent = '怪獣：未配置';
    __mhArea.textContent = 'エリア -';
    if(__mhStack) __mhStack.textContent = '下に0枚';
    __mhGrade.textContent = '-';
    __mhRage.textContent = String(rage);
    __mhThreat.textContent = __fmt(rage*5000);
  }

  __rhValue.textContent = __fmt(__calcTotalRepel());
  positionPlayHud();
}


// ===== STATE =====
let state={cards:{},order:[],undoStack:[]};
let deckPool=[],discardPool=[],monsterPool=[];let idCounter=0;let selection=new Set();const dupCountByName={};

createZones();
window.addEventListener('resize',()=>{applyUIScale();
  Object.values(zoneDom).forEach(d=>d.remove());
  createZones();
  try{ positionPlayHud(); }catch(e){}
  updateCounters();
  updateRageDisplay();
  try{ updatePreviewToolbarSafeVar(); }catch(e){}
  layoutHand(); // ← 追加
});

// ===== file handlers =====
fileInput.addEventListener('change',e=>handleFiles(e.target.files));
backInput.addEventListener('change',e=>setBackImage(e.target.files));
window.addEventListener('drop',e=>{e.preventDefault();handleFiles(e.dataTransfer.files);});window.addEventListener('dragover',e=>e.preventDefault());

function handleFiles(fileList){
  // Solo root: forward uploads to active iframe (don&apos;t add to hidden root board)
  if(!IS_EMBED && document.body.classList.contains('soloActive')){
    try{
      const fr = getActiveSoloFrame();
      const win = fr && fr.contentWindow;
      if(win){
        if(typeof win.handleFiles === 'function'){
          win.handleFiles(fileList);
        }else if(typeof win.addToDeck === 'function'){
          [...fileList].forEach(f=>{
            if(!f.type || !String(f.type).startsWith('image/')) return;
            const url = URL.createObjectURL(f);
            const name = f.name || url;
            win.addToDeck(url, name);
          });
          try{ win.pushUndo && win.pushUndo(); }catch(e){}
        }
      }
    }catch(e){ console.warn(e); }
    try{ fileInput.value=""; }catch(e){}
    return;
  }

  [...fileList].forEach(f=>{
    if(!f.type || !String(f.type).startsWith('image/')) return;
    const url = URL.createObjectURL(f);
    const name = f.name || url;
    addToDeck(url, name);
  });
  fileInput.value="";
  pushUndo();
}
function setBackImage(files){
  if(!files || !files.length){
    backSrc = WHITE_BACK;
    backInput.value="";
    updateBackImages();
    pushUndo();
    return;
  }

  // Solo root: broadcast back image to BOTH boards
  if(!IS_EMBED && document.body.classList.contains('soloActive')){
    try{
      const fOpp = $solo('soloFrameOpp');
      const fYou = $solo('soloFrameYou');
      [fOpp, fYou].forEach(fr=>{
        try{
          const win = fr && fr.contentWindow;
          if(win && typeof win.setBackImage === 'function') win.setBackImage(files);
        }catch(e){}
      });
    }catch(e){ console.warn(e); }
    try{ backInput.value=""; }catch(e){}
    return;
  }

  const f = files[0];
  backSrc = URL.createObjectURL(f);
  backInput.value="";
  updateBackImages();
  pushUndo();
}
function updateBackImages(){Object.values(state.cards).forEach(c=>{if(c.faceDown&&!['deckMain','discard'].includes(c.zone)){renderCard(c);}});}

function addToDeck(frontSrc,nameKey){dupCountByName[nameKey]=dupCountByName[nameKey]||0;if(dupCountByName[nameKey]>=MAX_DUP_PER_NAME){alert(`${nameKey} は上限${MAX_DUP_PER_NAME}枚です`);return;}dupCountByName[nameKey]++;const card=spawnCard(frontSrc,{zone:'deckMain',faceDown:true,origName:nameKey});hideIfPooled(card);deckPool.push(card.id);updateCounters();}

function spawnCard(frontSrc,preset){const id='c'+(idCounter++);const bw=board.clientWidth,bh=board.clientHeight;const card={id,front:frontSrc,x:bw/2-60+Math.random()*120-60,y:bh/2-80+Math.random()*120-80,scale:1,rot:0,zone:null,faceDown:false,origName:'',metaId:''};if(preset)Object.assign(card,preset);if(card.zone){const z=zones.find(z=>z.id===card.zone);if(z){card.x=z.x*bw+6+Math.random()*20;card.y=z.y*bh+6+Math.random()*20;}}state.cards[id]=card;state.order.push(id);renderCard(card);return card;}

function currentSrc(card){if(IS_SPECTATOR && card.zone==='hand') return backSrc;return card.faceDown?backSrc:card.front;}
function renderCard(card){
  let el=document.getElementById(card.id);
  if(!el){
    el=document.createElement('img');
    el.id=card.id;
    el.className='card';
    el.addEventListener('pointerdown',ev=>startDrag(ev,card));
    el.addEventListener('wheel',ev=>onWheel(ev,card));
    el.addEventListener('click',ev=>onClickCard(ev,card));
    el.onerror=()=>{el.src=WHITE_BACK;};
    board.appendChild(el);
  }
  el.src=currentSrc(card);
  el.style.left=card.x+'px';
  el.style.top=card.y+'px';
  el.style.transform=`scale(${card.scale}) rotate(${card.rot}deg)`;
  hideIfPooled(card);

  // counter overlay
  let ov=document.getElementById(card.id+'_ctr');
  if(!ov){
    ov=document.createElement('div');
    ov.id=card.id+'_ctr';
    ov.className='cardCounterOverlay hidden';
    ov.innerHTML='<div class="cardCounterBadge"></div>';
    board.appendChild(ov);
  }
  ov.style.left=card.x+'px';
  ov.style.top=card.y+'px';
  // overlay size: 画像未ロードでも高さが0にならないように固定比率で算出
  const baseW = el.offsetWidth || parseFloat(getComputedStyle(el).width) || 0;
  let baseH = el.offsetHeight;
  if(!baseH || baseH < 5) baseH = Math.round(baseW * 4 / 3);
  ov.style.width=baseW+'px';
  ov.style.height=baseH+'px';
  ov.style.transform=`scale(${card.scale}) rotate(${card.rot}deg)`;

  // 表示条件：カウンター有り & （共有用の手札は隠す） & プール非表示ゾーンでは隠す
  const arr=normalizeCounters(card);
  const pooledHidden = (['deckMain','discard'].includes(card.zone));
  const spectatorHandHidden = (IS_SPECTATOR && card.zone==='hand');
  if(arr.length && !pooledHidden && !spectatorHandHidden){
    const badge=ov.querySelector('.cardCounterBadge');
    if(badge){
      badge.innerHTML='';
      badge.style.maxWidth=(el.offsetWidth-12)+'px';
      const counts={};
      arr.forEach(v=>{
        v=Number(v)||0;
        if(!v) return;
        counts[v]=(counts[v]||0)+1;
      });
      // 種類が多いと横に広がりやすいので、少しだけ縮める
      const typeCount = Object.keys(counts).length;
      const ctrScale = (typeCount>=5) ? 0.78 : (typeCount===4 ? 0.84 : (typeCount===3 ? 0.9 : 1));
      badge.style.setProperty('--ctr-scale', String(ctrScale));
      Object.keys(counts).map(Number).sort((a,b)=>a-b).forEach(v=>{
        const n=counts[v]||0;
        const src=counterSrcByVal(v);
        if(!src) return;
        const item=document.createElement('div');
        item.className='ctrItem';
        const img=document.createElement('img');
        img.src=src;
        img.alt='+'+v;
        item.appendChild(img);
        if(n>1){
          const t=document.createElement('span');
          t.className='ctrCount';
          t.textContent='×'+n;
          item.appendChild(t);
        }
        badge.appendChild(item);
      });
      if(badge.childNodes.length){
        ov.classList.remove('hidden');
      }else{
        ov.classList.add('hidden');
      }
    }else{
      ov.classList.remove('hidden');
    }
  }else{
    ov.classList.add('hidden');
  }
}
function hideIfPooled(card){const el=document.getElementById(card.id);if(!el)return;if(['deckMain','discard'].includes(card.zone))el.classList.add('hidden');else el.classList.remove('hidden');}
function rerenderAll(){state.order.forEach(id=>renderCard(state.cards[id]));}

// selection / drag
function onClickCard(ev,card){if(ev.shiftKey){selection.has(card.id)?selection.delete(card.id):selection.add(card.id);}else{selection.clear();selection.add(card.id);}updateSelectionVisual();ev.stopPropagation();}
board.addEventListener('click',()=>{selection.clear();updateSelectionVisual();});
function updateSelectionVisual(){document.querySelectorAll('.card').forEach(e=>e.classList.remove('selected'));selection.forEach(id=>{const el=document.getElementById(id);if(el)el.classList.add('selected');});}
const DRAG_COMMIT_DISTANCE = 6;
let dragInfo=null;function startDrag(ev,card){ev.preventDefault();ev.stopPropagation();// 既に複数選択されている状態で、その中の1枚をドラッグ開始した時は選択を崩さない
const keepGroup=(!ev.shiftKey && selection.size>1 && selection.has(card.id));const multi=ev.shiftKey;if(!multi && !keepGroup){selection.clear();selection.add(card.id);updateSelectionVisual();}else if(multi && !selection.has(card.id)){selection.add(card.id);updateSelectionVisual();}let ids=[...selection];
  let altBulkMove=false;
  // Alt+ドラッグ：同一ゾーン（エリア）のカードをまとめて移動
  if(ev.altKey && card.zone && card.zone!=='hand' && card.zone!=='deckMain' && card.zone!=='discard'){
    const zIds=getZoneCardIds(card.zone);
    if(zIds.length>1){
      altBulkMove=true;
      ids = zIds.slice(); // 奥→手前（state.order準拠）
      // 選択表示も束に揃える
      selection.clear(); zIds.forEach(id=>selection.add(id));
      updateSelectionVisual();
    }
  }
  const p=getPointerBoardPos(ev);
  const rects=ids.map(id=>{const c=state.cards[id];return{id,dx:p.x-c.x,dy:p.y-c.y,startX:c.x,startY:c.y,startZone:c.zone};});dragInfo={ids,rects,altBulkMove};rects.forEach(r=>{const el=document.getElementById(r.id);el.classList.add('active');el.setPointerCapture(ev.pointerId);});document.addEventListener('pointermove',onDragMove,true);document.addEventListener('pointerup',onDragEnd,{once:true,capture:true});document.addEventListener('pointercancel',onDragEnd,{once:true,capture:true});}
function onDragMove(ev){if(!dragInfo)return;const p=getPointerBoardPos(ev);dragInfo.rects.forEach(r=>{const c=state.cards[r.id];c.x=p.x-r.dx;c.y=p.y-r.dy;renderCard(c);});scheduleSpectatorSyncFast();}
function placeCardInZoneOrder(cardId, zoneId, posMode){
  if(!zoneId || zoneId==='hand' || zoneId==='deckMain' || zoneId==='discard' || zoneId==='monster') return;
  const filtered=state.order.filter(id=>id!==cardId);
  const zoneIds=filtered.filter(id=>state.cards[id] && state.cards[id].zone===zoneId);
  if(!zoneIds.length){
    state.order=filtered.concat(cardId);
    syncOrderToDOM();
    return;
  }
  let zoneInsert=zoneIds.length;
  if(posMode==='bottom') zoneInsert=0;
  else if(posMode==='secondTop') zoneInsert=Math.max(0,zoneIds.length-1);
  const anchor=(zoneInsert>=zoneIds.length) ? null : zoneIds[zoneInsert];
  const anchorIdx=anchor ? filtered.indexOf(anchor) : -1;
  if(anchorIdx===-1) filtered.push(cardId);
  else filtered.splice(anchorIdx,0,cardId);
  state.order=filtered;
  syncOrderToDOM();
}
async function onDragEnd(ev){
  if(!dragInfo) return;
  const committedIds=[];
  document.removeEventListener('pointermove',onDragMove,true);
  const zoneDropChoice={};
  for(const r of dragInfo.rects){
    const el=document.getElementById(r.id);
    el.classList.remove('active');
    el.releasePointerCapture(ev.pointerId);

    const c=state.cards[r.id];
    const z=hitZone(c);
    const nextZone = z ? z.id : null;
    const movedDist = Math.hypot(c.x-r.startX, c.y-r.startY);
    const movedEnough = movedDist >= DRAG_COMMIT_DISTANCE;
    const zoneChanged = nextZone !== r.startZone;
    if(!movedEnough && !zoneChanged){
      c.x=r.startX; c.y=r.startY; c.zone=r.startZone;
      renderCard(c);
      continue;
    }

    committedIds.push(c.id);
    c.zone = nextZone;

    updatePoolsMembership(c);
    hideIfPooled(c);

    if(z){
      let dropPos='top';
      if(!dragInfo.altBulkMove && shouldAskStackDrop(c.id, z.id)){
        if(zoneDropChoice[z.id]) dropPos=zoneDropChoice[z.id];
        else{
          dropPos=await chooseStackDropPos(z.id);
          zoneDropChoice[z.id]=dropPos;
        }
      }
      placeCardInZoneOrder(c.id, z.id, dropPos);
    }
    if (snapEnabled && z) snapCardToZone(c, z);
    renderCard(c); // ←スナップ後の座標を反映
  }
  // （移動）
  try{
    const n = committedIds.length;
    if(n>0){
      const zonesAfter = [...new Set(dragInfo.rects.map(r=>state.cards[r.id]?.zone||null))];
      if(zonesAfter.length===1){
        const zId = zonesAfter[0];
        const z = (typeof zones!=='undefined' && Array.isArray(zones)) ? zones.find(z=>z.id===zId) : null;
        const nm = (z ? z.name : (zId||'場'));
        window.logAction && window.logAction(`移動：${n}枚 → ${nm}`);
      }else{
        window.logAction && window.logAction(`移動：${n}枚`);
      }
    }
  }catch(e){}
  dragInfo=null;
  if(committedIds.length>0){
    pushUndo();
    updateCounters();
  }
}
function hitZone(card){const cw=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-w'));const centerX=card.x+(cw*card.scale)/2;const centerY=card.y+(cw*1.333*card.scale)/2;const bw=board.clientWidth,bh=board.clientHeight;for(const z of zones){const zx=z.x*bw,zy=z.y*bh,zw=z.w*bw,zh=z.h*bh;if(centerX>zx&&centerX<zx+zw&&centerY>zy&&centerY<zy+zh){return z;}}return null;}

let snapEnabled = true;              // スナップON/OFF
const SNAP_STACK_DX = 10;            // 同じ枠に重なった時のズラし
const SNAP_STACK_DY = 6;

function cardSize(card){
  const cw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-w'));
  const w = cw * card.scale;
  const h = cw * 1.333 * card.scale; // hitZone()と同じ比率
  return { w, h };
}

function snapCardToZone(card, z){
  const bw = board.clientWidth, bh = board.clientHeight;

  // 手札は既存の整列ロジックを使う
  if (z.id === 'hand') { placeInHand(card); return; }

  // 山札/捨て札/怪獣は非表示になるので位置は重要じゃない（好みでセンター寄せでもOK）
  if (['deckMain','discard','monster'].includes(z.id)) return;

  const { w, h } = cardSize(card);

  // ゾーン中央に寄せる
  let x = z.x*bw + (z.w*bw - w)/2;
  let y = z.y*bh + (z.h*bh - h)/2;

  // 同じゾーンに既にある枚数ぶん、ちょっとだけずらして重なりが見えるようにする
  const siblings = Object.values(state.cards).filter(c => c.id !== card.id && c.zone === z.id);
  x += siblings.length * SNAP_STACK_DX;
  y += siblings.length * SNAP_STACK_DY;

  card.x = x;
  card.y = y;
}

// [patch] 盤面→山札へ戻す際の挿入位置を選択(上/下)
function updatePoolsMembership(card){
  if(card.zone==='deckMain'){
    if(!deckPool.includes(card.id)){
      if(deckReturnPos==='top'){deckPool.unshift(card.id);}else{deckPool.push(card.id);}
    }
    card.faceDown=true;
    hideIfPooled(card);
  }else{
    const i=deckPool.indexOf(card.id);if(i!==-1)deckPool.splice(i,1);
  }
  if(card.zone==='discard'){
    if(!discardPool.includes(card.id))discardPool.push(card.id);
    card.faceDown=true;hideIfPooled(card);
  }else{
    const j=discardPool.indexOf(card.id);if(j!==-1)discardPool.splice(j,1);
  }
  if(card.zone==='monster'){
    if(!monsterPool.includes(card.id))monsterPool.push(card.id);
    card.faceDown=true;
  }else{
    const k=monsterPool.indexOf(card.id);if(k!==-1)monsterPool.splice(k,1);
  }
}

function onWheel(ev,card){
  if(!ev.altKey) return;
  ev.preventDefault();
  const d = Math.sign(ev.deltaY) * -0.05;
  card.scale = Math.max(0.3, Math.min(2.5, card.scale + d));

  if(card.zone === 'hand') layoutHand();
  else renderCard(card);

  pushUndoDebounced();
}



// [patch] 表裏反転ボタン：選択カードを表/裏反転（Fキー）
btnFlip.onclick=()=>{
  if(!selection.size){alert('カードを選択してください');return;}
  let needLayout=false;
  selection.forEach(id=>{
    const c=state.cards[id]; if(!c) return;
    // 山札/捨て札は非表示なので対象外（公開は専用UIで）
    if(c.zone==='deckMain' || c.zone==='discard') return;
    c.faceDown=!c.faceDown;
    if(c.zone==='hand') needLayout=true;
    else renderCard(c);
  });
  if(needLayout) layoutHand();
  pushUndo();
};


// [patch] 消滅ボタン：選択カードを完全削除
btnRemove.onclick=()=>{if(!selection.size){alert('カードを選択してください');return;}selection.forEach(id=>removeCardById(id));selection.clear();updateSelectionVisual();updateCounters();pushUndo();};
function removeCardById(id){
  const i=deckPool.indexOf(id);if(i!==-1)deckPool.splice(i,1);
  const j=discardPool.indexOf(id);if(j!==-1)discardPool.splice(j,1);
  const k=monsterPool.indexOf(id);if(k!==-1)monsterPool.splice(k,1);
  const el=document.getElementById(id);if(el)el.remove();
  const ov=document.getElementById(id+'_ctr');if(ov)ov.remove();
  delete state.cards[id];
  state.order=state.order.filter(x=>x!==id);
}

btnToFront.onclick=()=>{if(!selection.size){alert('カードを選択してください');return;}selection.forEach(id=>bringToFront(id));pushUndo();};
btnToBack.onclick=()=>{if(!selection.size){alert('カードを選択してください');return;}selection.forEach(id=>bringToBack(id));pushUndo();};
btnUndo.onclick=undo;btnSave.onclick=saveLocal;btnLoad.onclick=loadLocal;
if(btnOpenSpectator) btnOpenSpectator.onclick=openSpectatorWindow;btnTurnStart.onclick=()=>{turnStart();};btnPreview.onclick=openPreview;btnBackToMode.onclick=()=>{ if(document.body.classList.contains('soloActive')){ exitSoloMode('start'); } else { goBackToMode(); } };
btnToken.onclick=()=>{openTokenSelector();};
if(btnCoin) btnCoin.onclick=doCoinToss;
updateCoinUI();

// [patch] keyboard shortcuts
// F = 表裏反転 / Delete = 消滅
document.addEventListener('keydown',(e)=>{if(IS_SPECTATOR) return;
  if(e.defaultPrevented) return;
  if(e.repeat) return;

  const ae=document.activeElement;
  if(ae && (ae.tagName==='INPUT' || ae.tagName==='TEXTAREA' || ae.isContentEditable)) return;

  // モーダル/ビルダー中は誤爆防止
  try{
    if(startModal && startModal.style.display!=='none') return;
    if(viewer && !viewer.classList.contains('hidden')) return;
    if(reveal && !reveal.classList.contains('hidden')) return;
    if(tokenModal && !tokenModal.classList.contains('hidden')) return;
        if(counterModal && !counterModal.classList.contains('hidden')) return;
if(stackModal && !stackModal.classList.contains('hidden')) return;
    if(preview && !preview.classList.contains('hidden')) return;
    if(builder && !builder.classList.contains('hidden')) return;
  }catch(err){}


  // solo root: forward counter shortcuts to active iframe (so selection works there)
  if(!IS_EMBED && document.body.classList.contains('soloActive')){
    if(e.key==='c' || e.key==='C'){
      e.preventDefault();
      e.stopImmediatePropagation();
      forwardCounterOpen();
      return;
    }else if(['1','2','3','4'].includes(e.key)){
      e.preventDefault();
      e.stopImmediatePropagation();
      const def=COUNTER_DEFS[Number(e.key)-1];
      if(def) forwardCounterAdd(def.val);
      return;
    }
  }

  if(e.key==='f' || e.key==='F'){
    e.preventDefault();
    btnFlip.click();
  }else if(e.key==='Delete'){
    e.preventDefault();
    btnRemove.click();
  }else if(e.key==='e' || e.key==='E'){
    e.preventDefault();
    if(btnToFront) btnToFront.click();
  }else if(e.key==='r' || e.key==='R'){
    e.preventDefault();
    if(btnToBack) btnToBack.click();
  }else if(e.key==='c' || e.key==='C'){
    e.preventDefault();
    if(btnCounter) btnCounter.click();
  }else if(['1','2','3','4'].includes(e.key)){
    e.preventDefault();
    const def=COUNTER_DEFS[Number(e.key)-1];
    if(def) applyCounterToSelection(def.val);
  }else if(e.code==='Space' || e.key===' '){
    e.preventDefault();
    openPreview();
  }
});
function bringToFront(id){
  state.order=state.order.filter(x=>x!==id);
  state.order.push(id);
  const el=document.getElementById(id);
  if(el) board.appendChild(el);
  const ov=document.getElementById(id+'_ctr');
  if(ov) board.appendChild(ov);
} 
function bringToBack(id){
  state.order=state.order.filter(x=>x!==id);
  state.order.unshift(id);
  const el=document.getElementById(id);
  const ov=document.getElementById(id+'_ctr');
  if(el){
    const first=board.querySelector('.card');
    if(first) board.insertBefore(el, first);
    else board.appendChild(el);
    if(ov) board.insertBefore(ov, el.nextSibling);
  }else{
    if(ov) board.appendChild(ov);
  }
}

// preview
function escHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, (ch)=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}

// ===== Inline keyword icons (preview info) =====
function _iconPng(name){
  return `${CARD_FOLDER}/${encodeURIComponent(String(name))}.png`;
}
function _toZenkakuDigits(s){
  return String(s).replace(/[0-9]/g, d => String.fromCharCode(d.charCodeAt(0) + 0xFEE0));
}
function _makeImgWithFallback(srcList, altText, className='inline-icon'){
  const img = document.createElement('img');
  img.alt = altText;
  img.className = className;
  img.loading = 'lazy';
  let i = 0;
  img.src = srcList[i];
  img.onerror = () => {
    i++;
    if(i < srcList.length){
      img.src = srcList[i];
    }else{
      try{ img.replaceWith(document.createTextNode(altText)); }catch(e){}
    }
  };
  return img;
}

const INLINE_ICON_TOKENS = [
  '相手のターン中','あなたのターン中',
  '怒り','覚醒4','覚醒6','覚醒8',
  '逆襲','強襲','共鳴','拠点',
  '出現時','進化','進攻時','破壊','進攻1','進攻2','進化1','進化2','進化3','進化4','進化5','進化6','進化7','進化8'
];
const INLINE_ICON_MAP = Object.fromEntries(INLINE_ICON_TOKENS.map(t => [t, _iconPng(t)]));

function _escapeRegExp(s){ return String(s).replace(/[.*+?^${}()|[\[\]\\]/g, '\\$&'); }

// 「＜＞」「<>」で囲まれたトークン（例: ＜デストロイア＞）をアイコン化
const BRACKET_TOKEN_PATTERN = '[＜<][^＜＞<>]{1,40}[＞>]';

// 強襲は「強襲」「強襲1〜4」「強襲2」など表記ゆれがあるのでパターンで拾う（数字は半角/全角・空白ありでもOK）
const INLINE_ICON_PATTERNS = [
  BRACKET_TOKEN_PATTERN,
  '強襲[ 　]*[1-4１-４][ 　]*[〜～\\-][ 　]*[1-4１-４]', // 例: 強襲1〜4 / 強襲１-４
  '強襲[ 　]*[1-4１-４]',                               // 例: 強襲2 / 強襲 ２
  ...INLINE_ICON_TOKENS.filter(t => t !== '強襲').slice().sort((a,b)=>b.length-a.length).map(_escapeRegExp),
  '強襲'
];
const _INLINE_ICON_RE = new RegExp(`(${INLINE_ICON_PATTERNS.join('|')})`, 'g');

function _zenkakuToHankakuDigits(s){
  return String(s).replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0));
}

function _buildInlineIconNode(token){
  const raw = String(token ?? '');

  // --- ＜デストロイア＞ / <デストロイア> ---
  const br = raw.match(/^(?:＜|<)([^＜＞<>]+)(?:＞|>)$/);
  if(br){
    const inner = br[1];
    return _makeImgWithFallback([
      _iconPng(raw),   // "＜デストロイア＞.png"（要望通り）
      _iconPng(inner)  // "デストロイア.png"（保険）
    ], raw);
  }

  // --- 強襲（番号付き/範囲付き） ---
  if(raw.startsWith('強襲')){
    const compact = _zenkakuToHankakuDigits(raw).replace(/[ 　]/g,''); // 全角/半角空白除去・数字は半角化
    const range = compact.match(/^強襲([1-4])([〜～\\-])([1-4])$/);
    if(range){
      // 範囲表記（例: 強襲1〜4）は、該当する番号分のアイコンを並べて表示する
      const frag = document.createDocumentFragment();
      const a = Number(range[1]);
      const b = Number(range[3]);
      const start = Math.min(a,b);
      const end   = Math.max(a,b);

      for(let i=start;i<=end;i++){
        const fw = _toZenkakuDigits(String(i));
        const img = _makeImgWithFallback([
          `${CARD_FOLDER}/強襲${i}.png`,
          `${CARD_FOLDER}/強襲${fw}.png`,
          `${CARD_FOLDER}/強襲.png`
        ], `強襲${i}`);
        frag.appendChild(img);
        if(i<end) frag.appendChild(document.createTextNode(' '));
      }
      return frag;
    }

    const single = compact.match(/^強襲([1-4])$/);
    if(single){
      const i = Number(single[1]);
      const fw = _toZenkakuDigits(String(i));
      return _makeImgWithFallback([
        `${CARD_FOLDER}/強襲${i}.png`,
        `${CARD_FOLDER}/強襲${fw}.png`,
        `${CARD_FOLDER}/強襲.png`
      ], raw);
    }

    // 「強襲」単体
    return _makeImgWithFallback([`${CARD_FOLDER}/強襲.png`], raw);
  }

  // --- それ以外は固定トークン ---
  return _makeImgWithFallback([INLINE_ICON_MAP[raw] || _iconPng(raw)], raw);
}

function applyInlineIcons(root){
  if(!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n){
      if(!n || !n.nodeValue) return NodeFilter.FILTER_REJECT;
      if(!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const p = n.parentNode;
      if(!p) return NodeFilter.FILTER_REJECT;
      const tag = p.nodeName;
      if(tag==='SCRIPT' || tag==='STYLE' || tag==='TEXTAREA' || tag==='INPUT') return NodeFilter.FILTER_REJECT;
      // skip inside buttons/labels where layout can break
      if(tag==='BUTTON') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes=[];
  let n;
  while((n = walker.nextNode())) nodes.push(n);

  for(const node of nodes){
    const text = node.nodeValue;
    if(!_INLINE_ICON_RE.test(text)) { _INLINE_ICON_RE.lastIndex = 0; continue; }
    _INLINE_ICON_RE.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let last = 0;
    let m;
    while((m = _INLINE_ICON_RE.exec(text)) !== null){
      const idx = m.index;
      const token = m[1];
      if(idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));

      const iconNode = _buildInlineIconNode(token);

      // 進攻アイコン（黒+透過）は背景付きで見やすく
      if((token==='進攻1' || token==='進攻2') && iconNode && iconNode.nodeType===1 && iconNode.tagName==='IMG'){
        iconNode.classList.add('adv-icon');
        const wrap = document.createElement('span');
        wrap.className = 'advBadge';
        wrap.appendChild(iconNode);
        frag.appendChild(wrap);
      }else{
        frag.appendChild(iconNode);
      }

      last = idx + token.length;
    }
    if(last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));

    node.parentNode.replaceChild(frag, node);
  }
}

function advanceToHtml(advRaw){
  const n = (advRaw==null || advRaw==='—') ? null : Number(advRaw);
  if(n===1 || n===2){
    const token = `進攻${n}`;
    const src = _iconPng(token);
    return `<span class="advBadge"><img class="inline-icon adv-icon" src="${src}" alt="${token}" loading="lazy" onerror="this.replaceWith(document.createTextNode('${token}'))"></span>`;
  }
  return escHtml(advRaw!=null ? advRaw : '—');
}

function colorToHtml(colorRaw){
  const c = String(colorRaw ?? '—').trim();
  if(c==='赤' || c==='青' || c==='白' || c==='緑'){
    const src = _iconPng(c);
    return `<img class="inline-icon color-icon" src="${src}" alt="${c}" loading="lazy" onerror="this.replaceWith(document.createTextNode('${c}'))">`;
  }
  return escHtml(colorRaw!=null ? colorRaw : '—');
}

function buildPreviewInfoHtml(card, meta){
  const idRaw = String(card && card.id ? card.id : '');
  const idDisp = idRaw.replace(/ol$/i,'');
  const id = escHtml(idDisp);
  const set = escHtml(card && card.set ? card.set : '');
  const name = escHtml(meta && meta.name ? meta.name : (card && card.name ? card.name : id));
  const colorRaw = (meta && meta.color ? meta.color : '—');
  const colorHtml = colorToHtml(colorRaw);
  const type  = escHtml(meta && meta.type  ? meta.type  : '—');
  const grade = escHtml(meta && meta.grade != null ? meta.grade : '—');
  const advRaw = (meta && meta.advance != null ? meta.advance : null);
  const advHtml = advanceToHtml(advRaw);
  const power = escHtml(meta && meta.power != null ? meta.power : '—');
  const feats = (meta && Array.isArray(meta.features)) ? meta.features : [];
  const txt   = meta && meta.text ? meta.text : '';

  let html = `<div class="pvTitle">${name}</div>`;
  html += `<div class="pvSub">${id}${set ? ` / ${set}` : ''}${meta ? '' : ' / （メタ未登録）'}</div>`;
  html += `<div class="pvRow pvRowMeta">`
    + `<span class="pvItem"><span class="pvKey">色</span><span class="pvVal">${colorHtml}</span></span>`
    + `<span class="pvItem"><span class="pvKey">種別</span><span class="pvVal">${type}</span></span>`
    + `</div>`;
  html += `<div class="pvRow pvRowMeta">`
    + `<span class="pvItem"><span class="pvKey">等級</span><span class="pvVal">${grade}</span></span>`
    + `<span class="pvItem"><span class="pvKey">進攻</span><span class="pvVal">${advHtml}</span></span>`
    + `<span class="pvItem"><span class="pvKey">脅威度/撃退力</span><span class="pvVal">${power}</span></span>`
    + `</div>`;

  if(feats.length){
    html += `<div class="pvTags">` + feats.map(t=>`<span class="pvTag">${escHtml(t)}</span>`).join('') + `</div>`;
  }
  if(txt){
    html += `<div class="pvText">${escHtml(txt)}</div>`;
  }else{
    html += `<div class="pvText">（テキスト未登録）</div>`;
  }
  return html;
}

const previewInfo=document.getElementById('previewInfo');

function updatePreviewToolbarSafeVar(){
  try{
    const tb = document.getElementById('toolbar');
    if(!tb) return 0;
    // toolbar is scaled by --ui-scale, so DOMRect is the actual on-screen size
    const h = tb.getBoundingClientRect().height;
    const safe = Math.ceil(h + 12);
    document.documentElement.style.setProperty('--previewSafeTop', String(safe) + 'px');
    return safe;
  }catch(e){
    return 0;
  }
}

function openPreviewByCardId(cardId){
  const card = CARD_DB.find(c=>c.id===cardId) || {id:cardId,name:cardId,set:getSetKeyFromId(cardId),srcGuess:WHITE_BACK};
  const meta = getMetaById(cardId);
  previewImg.src = card.srcGuess || WHITE_BACK;
  if(previewInfo) previewInfo.innerHTML = buildPreviewInfoHtml(card, meta);

  if(previewInfo) applyInlineIcons(previewInfo);
updatePreviewToolbarSafeVar();
  preview.classList.remove('hidden');
}
function openPreview(){
  if(!selection.size){alert('カードを選択してください');return;}
  const id=[...selection][selection.size-1];
  const c=state.cards[id];
  previewImg.src=c.front;
  const metaKey = String((c.metaId||c.origName||'')).replace(/\.png$/i,'');
  const meta = getMetaById(metaKey);
  const fakeCard = {id: metaKey, name: (meta && meta.name) ? meta.name : metaKey, set:getSetKeyFromId(metaKey)};
  if(previewInfo) previewInfo.innerHTML = buildPreviewInfoHtml(fakeCard, meta);

  if(previewInfo) applyInlineIcons(previewInfo);
updatePreviewToolbarSafeVar();
  preview.classList.remove('hidden');
}
function closePreview(){
  preview.classList.add('hidden');
  // restore z-index if temporarily raised (e.g., from 2Pick)
  if(preview && preview.dataset && preview.dataset._zRestore!=null){
    preview.style.zIndex = preview.dataset._zRestore;
    delete preview.dataset._zRestore;
  }
}

previewClose.onclick=closePreview;preview.addEventListener('click',e=>{if(e.target===preview)closePreview();});
// [fix] preview open中は Esc で閉じる
document.addEventListener('keydown',(e)=>{if(IS_SPECTATOR) return; if(!preview.classList.contains('hidden') && e.key==='Escape'){e.preventDefault(); closePreview();}});


// token selector
let tokenSelection=null;
function openTokenSelector(){
  tokenSelection=null;tokenGrid.innerHTML='';tokenCountInput.value='1';
  const tokens=['BP02-T01','BP02-T02','BP02-T03','BP02-T04','BP04-T01'];
  tokens.forEach(id=>{
    const w=document.createElement('div');w.className='tokenThumb';w.dataset.id=id;
    const img=document.createElement('img');img.src=`${CARD_FOLDER}/${id}.png`;img.onerror=()=>{img.src=WHITE_BACK;};
    const nm=document.createElement('div');nm.className='tokenName';nm.textContent=id.replace('BP02-','');
    w.appendChild(img);w.appendChild(nm);
    w.onclick=()=>{
      tokenSelection=id;
      tokenGrid.querySelectorAll('.tokenThumb').forEach(el=>el.classList.toggle('selected',el.dataset.id===id));
    };
    tokenGrid.appendChild(w);
  });
  // 初期選択（最初のトークン）
  const first=tokenGrid.querySelector('.tokenThumb');
  if(first){tokenSelection=first.dataset.id;first.classList.add('selected');}
  tokenModal.classList.remove('hidden');
}
function closeTokenSelector(){tokenModal.classList.add('hidden');}
btnTokenCancel.onclick=closeTokenSelector;
btnTokenCreate.onclick=()=>{
  if(!tokenSelection){alert('トークンを選択してください');return;}
  const n=Math.max(1,Math.min(20,parseInt(tokenCountInput.value||'1',10)||1));
  const src=`${CARD_FOLDER}/${tokenSelection}.png`;
  spawnTokens(src,tokenSelection,n);
  pushUndo();
  closeTokenSelector();
};
// Enterで生成、Escで閉じる
tokenModal.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();btnTokenCreate.click();}
  if(e.key==='Escape'){e.preventDefault();closeTokenSelector();}
});
function spawnTokens(src,origName,count){
  const z=zones.find(z=>z.id==='hand');
  const bw=board.clientWidth,bh=board.clientHeight;
  const baseX=z.x*bw-120; // さらに左へオフセット
  const baseY=z.y*bh+10;
  for(let i=0;i<count;i++){
    const c=spawnCard(src,{zone:null,faceDown:false,origName,metaId:origName});
    c.x=baseX- (i*2);
    c.y=baseY+ (i*2);
    renderCard(c);bringToFront(c.id);
  }
}

// viewer
function openViewer(mode){if(IS_SPECTATOR) return;if(revealIsOpen()){alert('公開中です。先に公開カードを処理してください。');return;}viewerMode=mode;viewerSelection.clear();lastViewerPickedId=null;viewerTitle.textContent=mode==='deck'?'山札をサーチ':'捨て札をサーチ';viewerSearchInput.value='';buildViewerGrid();btnViewerToDiscard.style.display=(mode==='deck')?'':'none';viewer.classList.remove('hidden');viewerSearchInput.focus();sendViewerUiToSpectator();sendPickToSpectator();}
function closeViewer(){viewer.classList.add('hidden');viewerSelection.clear();lastViewerPickedId=null;sendViewerUiToSpectator();sendPickToSpectator();}
function buildViewerGrid(){viewerGrid.innerHTML='';const list=(viewerMode==='deck'?deckPool:discardPool).map(id=>state.cards[id]);list.forEach(c=>{const w=document.createElement('div');w.className='thumbWrap';w.dataset.id=c.id;const img=document.createElement('img');img.src=c.front;w.appendChild(img);const nm=document.createElement('div');nm.className='thumbName';nm.textContent=c.origName||'';w.appendChild(nm);w.onclick=()=>toggleThumb(w);viewerGrid.appendChild(w);});}
function toggleThumb(w){if(IS_SPECTATOR) return;const id=w.dataset.id;lastViewerPickedId=id;if(viewerSelection.has(id)){viewerSelection.delete(id);w.classList.remove('selected');}else{viewerSelection.add(id);w.classList.add('selected');}if(viewerMode==='deck'){sendPickToSpectator();}sendViewerUiToSpectator();}
function toggleViewerSelectAll(){if(IS_SPECTATOR) return;const all=[...viewerGrid.querySelectorAll('.thumbWrap')];const doSel=viewerSelection.size!==all.length;viewerSelection.clear();all.forEach(w=>{if(doSel){viewerSelection.add(w.dataset.id);w.classList.add('selected');}else{w.classList.remove('selected');}});if(viewerMode==='deck'){lastViewerPickedId=null;sendPickToSpectator();}sendViewerUiToSpectator();}
viewerSearchInput.addEventListener('input',()=>{const q=viewerSearchInput.value.toLowerCase();viewerGrid.querySelectorAll('.thumbWrap').forEach(w=>{const id=w.dataset.id;const c=state.cards[id];const hit=(c.origName||'').toLowerCase().includes(q);w.style.display=hit?'':'';});});
btnViewerCancel.onclick=closeViewer;btnViewerSelectAll.onclick=toggleViewerSelectAll;btnViewerToHand.onclick=viewerMoveToHand;btnViewerToDiscard.onclick=viewerMoveToDiscard;
function viewerMoveToHand(){if(!viewerSelection.size){alert('カードを選択してください');return;}viewerSelection.forEach(id=>{const arr=viewerMode==='deck'?deckPool:discardPool;const idx=arr.indexOf(id);if(idx!==-1)arr.splice(idx,1);const c=state.cards[id];c.zone='hand';c.faceDown=false;placeInHand(c);bringToFront(id);renderCard(c);});updateCounters();pushUndo();closeViewer();}
function viewerMoveToDiscard(){if(viewerMode!=='deck')return;if(!viewerSelection.size){alert('カードを選択してください');return;}viewerSelection.forEach(id=>{const idx=deckPool.indexOf(id);if(idx!==-1)deckPool.splice(idx,1);const c=state.cards[id];c.zone='discard';c.faceDown=true;hideIfPooled(c);if(!discardPool.includes(id))discardPool.push(id);renderCard(c);});updateCounters();pushUndo();closeViewer();}

// counters & pools
function updateCounters(){deckCounterEl.textContent=`山札:${deckPool.length}枚`;discardCounterEl.textContent=`捨て札:${discardPool.length}枚`;monsterCounterEl.textContent=`怪獣:${monsterPool.length}枚`;}
function shuffleDeck(){for(let i=deckPool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deckPool[i],deckPool[j]]=[deckPool[j],deckPool[i]];}deckPool.forEach(id=>{const c=state.cards[id];c.zone='deckMain';c.faceDown=true;hideIfPooled(c);});updateCounters();}

// [fix] 捨て札→山札へ戻す（捨て札ゾーンの「山札へ戻す」ボタン）
function discardToDeck(){
  if(IS_SPECTATOR) return false;
  const n = discardPool.length;
  if(n===0){ alert('捨て札がありません'); return false; }
  if(!confirm(`捨て札${n}枚を山札へ戻しますか？`)) return false;

  const moving = discardPool.slice(); // 古い→新しい（末尾が一番上）
  // 先にカード状態を更新
  moving.forEach(id=>{
    const c = state.cards[id];
    if(!c) return;
    c.zone = 'deckMain';
    c.faceDown = true;
    hideIfPooled(c);
    renderCard(c);
  });

  // 山札へ追加（戻す位置：上/下）
  if(deckReturnPos==='top'){
    // 末尾（捨て札の一番上）が新しい山札の一番上になるように unshift を順に実行
    moving.forEach(id=>{
      if(!deckPool.includes(id)) deckPool.unshift(id);
    });
  }else{
    moving.forEach(id=>{
      if(!deckPool.includes(id)) deckPool.push(id);
    });
  }

  // 捨て札は空に
  discardPool = [];

  // ビューア表示中なら更新
  try{
    if(typeof viewerMode!=='undefined' && viewerMode==='discard' && viewer && !viewer.classList.contains('hidden')){
      viewerSelection?.clear?.();
      lastViewerPickedId = null;
      buildViewerGrid();
      sendViewerUiToSpectator();
      sendPickToSpectator();
    }
  }catch(e){}

  updateCounters();
  return true;
}


// [patch] ドローは deckPool 先頭から
function drawFromDeck(n){
  for(let i=0;i<n;i++){
    if(deckPool.length===0)break;
    const id=deckPool.shift();
    const c=state.cards[id];
    c.zone='hand';
    c.faceDown=false;
    placeInHand(c);
    bringToFront(id);
    renderCard(c);
  }
  updateCounters();
}

// どこから呼ばれても「手札は全部整列する」
let handOrderCounter = 0;

function layoutHand(){
  const z = zones.find(z=>z.id==='hand');
  if(!z) return;

  const bw = board.clientWidth, bh = board.clientHeight;
  const startX = z.x*bw + 20;
  let y      = z.y*bh - 10;
  const endX   = z.x*bw + z.w*bw - 20;
  const avail  = Math.max(0, endX - startX);

  const baseW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-w'));
  const handCards = Object.values(state.cards).filter(c => c.zone === 'hand');
  if(!handCards.length) return;

  // 反転レイアウト(上側手札)は、カードが盤面にかぶらないように上端へ“はみ出し”表示にする
  if(FLIP_LAYOUT){
    const maxH = Math.max(...handCards.map(c => baseW * 1.333 * ((c.scale==null)?1:c.scale)));
    const visible = Math.max(90, Math.min(maxH, z.h*bh + 30));
    y = y - (maxH - visible);
  }


  // 既存の順番があればそれを活かす（保存/読込後も崩れにくい）
  handOrderCounter = Math.max(handOrderCounter, ...handCards.map(c=>c._handOrder||0));

  handCards.forEach(c=>{
    if(c._handOrder == null) c._handOrder = ++handOrderCounter;
  });
  handCards.sort((a,b)=>(a._handOrder||0)-(b._handOrder||0));

  const widths = handCards.map(c => baseW * c.scale);
  const totalW = widths.reduce((s,w)=>s+w,0);

  const BASE_GAP = 14;     // 余裕ある時の隙間
  const MIN_STEP = 28;     // “詰めすぎ”防止（次のカードが最低これだけ見える）
  let gap = BASE_GAP;

  if(handCards.length > 1){
    // 収まらないなら gap を自動計算（必要なら重なりもOK）
    const needGap = (avail - totalW) / (handCards.length - 1);
    const minW = Math.min(...widths);
    const minGap = MIN_STEP - minW;      // step = minW + gap >= MIN_STEP を保証
    gap = Math.max(minGap, Math.min(BASE_GAP, needGap));
  }

  let x = startX;
  for(let i=0;i<handCards.length;i++){
    const c = handCards[i];
    c.x = x;
    c.y = y;
    x += widths[i] + gap;
    renderCard(c);
  }
}

function placeInHand(card){
  if(card._handOrder == null) card._handOrder = ++handOrderCounter;
  layoutHand();
}




// [patch] moveSelectionToZone 経由でも戻し位置を反映
function moveSelectionToZone(zoneId){const z=zones.find(z=>z.id===zoneId);if(!z)return;const bw=board.clientWidth,bh=board.clientHeight;selection.forEach(id=>{const c=state.cards[id];c.zone=zoneId;if(zoneId==='deckMain'){c.faceDown=true;hideIfPooled(c);if(!deckPool.includes(id)){if(deckReturnPos==='top'){deckPool.unshift(id);}else{deckPool.push(id);}}const j=discardPool.indexOf(id);if(j!==-1)discardPool.splice(j,1);}else if(zoneId==='discard'){c.faceDown=true;hideIfPooled(c);if(!discardPool.includes(id))discardPool.push(id);const i=deckPool.indexOf(id);if(i!==-1)deckPool.splice(i,1);}else if(zoneId==='hand'){c.faceDown=false;placeInHand(c);hideIfPooled(c);const i=deckPool.indexOf(id);if(i!==-1)deckPool.splice(i,1);const j=discardPool.indexOf(id);if(j!==-1)discardPool.splice(j,1);}else{c.x=z.x*bw+6+Math.random()*20;c.y=z.y*bh+6+Math.random()*20;hideIfPooled(c);const i=deckPool.indexOf(id);if(i!==-1)deckPool.splice(i,1);const j=discardPool.indexOf(id);if(j!==-1)discardPool.splice(j,1);}renderCard(c);});updateCounters();}

function turnStart(){['strategy1','strategy2'].forEach(zid=>{Object.values(state.cards).forEach(c=>{if(c.zone===zid){c.zone='discard';c.faceDown=true;hideIfPooled(c);if(!discardPool.includes(c.id))discardPool.push(c.id);const di=deckPool.indexOf(c.id);if(di!==-1)deckPool.splice(di,1);renderCard(c);}});});rageCount=0;updateRageDisplay();updateCounters();pushUndo();}

// undo/save
function pushUndo(){const snap=JSON.stringify(lightState());state.undoStack.push(snap);if(state.undoStack.length>50)state.undoStack.shift();}
let undoTimer=null;function pushUndoDebounced(){clearTimeout(undoTimer);undoTimer=setTimeout(pushUndo,400);} 
function undo(){
  // 公開モーダル中のUndoは「キャンセル（開始前へ戻す）」として扱う
  if(revealIsOpen() || revealPool.length){ cancelReveal(); return; }
  if(state.undoStack.length<2) return;
  state.undoStack.pop();
  loadFromJSON(state.undoStack[state.undoStack.length-1],false);
} 
function lightState(){const {cards,order}=state;return {cards,order,deckPool,discardPool,monsterPool,dupCountByName,backSrc,rageCount,lastCoin};}
function saveLocal(){try{const json=JSON.stringify(lightState());const bytes=new Blob([json]).size;if(bytes>MAX_SAVE_BYTES){alert(`保存データが大きすぎます (約${(bytes/1024).toFixed(1)}KB)`);return;}localStorage.setItem('go_state',json);alert('保存しました');}catch(e){alert('保存中エラー:'+e.message);}}
function loadLocal(){try{const json=localStorage.getItem('go_state');if(!json){alert('データがありません');return;}loadFromJSON(json,true);}catch(e){alert('読込中エラー:'+e.message);}}
function loadFromJSON(json,push=true){
  // 既存DOMを削除
  Object.values(state.cards).forEach(c=>{
    const el=document.getElementById(c.id);
    if(el) el.remove();
    const ov=document.getElementById(c.id+'_ctr');
    if(ov) ov.remove();
  });

  const p=JSON.parse(json);
  state.cards=p.cards||{};
    // カウンター未保存の古いデータ対策
  Object.values(state.cards).forEach(c=>{ if(!c) return; if(!Array.isArray(c.counters)){ const v=Number(c.counterVal)||0; c.counters = v?[v]:[]; } c.counterVal = c.counters.reduce((a,b)=>a+(Number(b)||0),0); });
state.order=p.order||Object.keys(state.cards);
  deckPool=p.deckPool||[];
  discardPool=p.discardPool||[];
  monsterPool=p.monsterPool||[];
  Object.assign(dupCountByName,p.dupCountByName||{});
  backSrc=p.backSrc||WHITE_BACK;
  rageCount=p.rageCount||0;
  // phase/coin meta
try{ lastCoin = (Object.prototype.hasOwnProperty.call(p,'lastCoin')) ? p.lastCoin : null; }catch(e){ lastCoin = null; }

  // 観戦(spectator)側は公開モーダルを GCARD_REVEAL メッセージで制御するため、
  // GCARD_SYNC のたびに勝手に閉じないようにする（ここが「一瞬で閉じる」原因）
  if(!IS_SPECTATOR){
    revealPool=[];
    revealOriginal=[];
    revealSelection.clear();
    revealTxnSnap=null;
    revealUndoMark=null;
    closeRevealModal();
  }

  idCounter=Object.keys(state.cards).length;
  state.order.forEach(id=>renderCard(state.cards[id]));
  updateCounters();
  updateRageDisplay();
  updateCoinUI();

  if(!IS_SPECTATOR){
    if(revealPool && revealPool.length){ showRevealModal(); }
    else { closeRevealModal(); }
  }

  if(push) pushUndo();
  selection.clear();
  updateSelectionVisual();
}

// ===== start modal handlers =====
function setPlayModeUI(active){
  try{ document.body.classList.toggle('playMode', !!active); }catch(e){}
}

function initThreatCalcTool(){
  const toolFallbackSrc = CARD_BACK_SRC;
  const battleList=document.getElementById('tcBattleList');
  const threatEl=document.getElementById('tcThreatResult');
  const repelEl=document.getElementById('tcRepelResult');
  const diffEl=document.getElementById('tcDiffResult');
  const monsterImg=document.getElementById('tcMonsterImg');
  const monsterNameEl=document.getElementById('tcMonsterName');
  const monsterBaseEl=document.getElementById('tcMonsterBase');
  const monsterPickBtn=document.getElementById('tcMonsterPick');
  const rageEl=document.getElementById('tcRage');
  const monsterCounterEl=document.getElementById('tcMonsterCounter');
  const strategyCounterEl=document.getElementById('tcStrategyCounter');
  const picker=document.getElementById('tcCardPicker');
  const pickerTitle=document.getElementById('tcPickerTitle');
  const pickerClose=document.getElementById('tcPickerClose');
  const pickerSearch=document.getElementById('tcPickerSearch');
  const pickerSet=document.getElementById('tcPickerSet');
  const pickerList=document.getElementById('tcPickerList');
  if(!battleList || !threatEl || !repelEl || !diffEl || !monsterPickBtn) return;

  const cardInfoMap=new Map();
  if(typeof CARD_DB!=='undefined' && Array.isArray(CARD_DB)){
    CARD_DB.forEach((c)=>{
      const id=String(c && c.id ? c.id : '').replace(/\.png$/i,'');
      if(!id || cardInfoMap.has(id)) return;
      const meta=(typeof getMetaById==='function') ? getMetaById(id) : (c && c.meta ? c.meta : null);
      cardInfoMap.set(id, {
        id,
        name: String((meta && meta.name) || (c && c.name) || id),
        type: String((meta && meta.type) || ''),
        power: Number((meta && meta.power) || 0),
        set: String((c && c.set) || ''),
        src: (c && c.srcGuess) ? String(c.srcGuess) : `${CARD_FOLDER}/${id}.png`
      });
    });
  }

  const compareCardsByNumber=(a,b)=>{
    const na = (typeof __buildCardNoNum==='function') ? __buildCardNoNum(a && a.id) : 999999;
    const nb = (typeof __buildCardNoNum==='function') ? __buildCardNoNum(b && b.id) : 999999;
    if(na!==nb) return na-nb;
    return String(a && a.id || '').localeCompare(String(b && b.id || ''), 'ja');
  };

  const byType=(type)=>{
    const rows=[];
    cardInfoMap.forEach((info)=>{
      if(!info || info.type!==type) return;
      rows.push(info);
    });
    rows.sort(compareCardsByNumber);
    return rows;
  };

  const monsterCards=byType('怪獣');
  const battleCards=byType('交戦');
  const getInfo=(id)=> id ? cardInfoMap.get(String(id).replace(/\.png$/i,'')) : null;
  if(monsterImg){
    monsterImg.src=toolFallbackSrc;
    monsterImg.onerror=()=>{ monsterImg.src=WHITE_BACK; };
  }

  if(!battleList.dataset.ready){
    const rows=[];
    for(let i=1;i<=7;i++){
      rows.push(`
        <div class="tcBattleRow">
          <div class="slotLabel">交戦${i}</div>
          <button type="button" class="tcPickBtn" data-tc="battlePick" data-slot="${i-1}">交戦カードを選ぶ</button>
          <img class="tcBattleThumb" data-tc="battleImg" src="${toolFallbackSrc}" alt="交戦カード画像プレビュー">
          <div class="tcBaseVal" data-tc="battleBase">素:0</div>
          <label>カウンター<input type="number" inputmode="numeric" data-tc="battleCounter" value="0"></label>
        </div>
      `);
    }
    battleList.innerHTML=rows.join('');
    battleList.dataset.ready='1';
  }

  const picked={ monster:'', battles: Array(7).fill('') };

  const renderSets=(cards)=>{
    const uniq=new Set(cards.map(c=>c.set).filter(Boolean));
    const ordered = (typeof getAvailableSetsOrder==='function')
      ? getAvailableSetsOrder().filter(k=>uniq.has(k))
      : Array.from(uniq).sort((a,b)=>a.localeCompare(b,'ja'));
    pickerSet.innerHTML = ['<option value="">弾:すべて</option>']
      .concat(ordered.map(set=>`<option value="${set}">${set}</option>`)).join('');
  };

  let pickerCtx = null;

  function closePicker(){
    if(!picker) return;
    picker.classList.add('hidden');
    pickerCtx = null;
  }

  function applyPickedCard(info){
    if(!pickerCtx || !info) return;
    if(pickerCtx.kind==='monster'){
      picked.monster = info.id;
      if(monsterImg) monsterImg.src = info.src || WHITE_BACK;
      if(monsterNameEl) monsterNameEl.textContent = info.name || info.id;
      if(monsterBaseEl) monsterBaseEl.textContent = `素:${__fmt(info.power||0)}`;
      if(monsterPickBtn) monsterPickBtn.textContent = `怪獣: ${info.name}`;
    }else if(pickerCtx.kind==='battle'){
      const idx = pickerCtx.index|0;
      if(idx>=0 && idx<picked.battles.length){
        picked.battles[idx] = info.id;
        const row = battleList.querySelector(`.tcBattleRow button[data-slot="${idx}"]`)?.closest('.tcBattleRow');
        if(row){
          const btn=row.querySelector('button[data-tc="battlePick"]');
          const img=row.querySelector('img[data-tc="battleImg"]');
          const base=row.querySelector('[data-tc="battleBase"]');
          if(btn) btn.textContent = info.name;
          if(img) img.src = info.src || WHITE_BACK;
          if(base) base.textContent = `素:${__fmt(info.power||0)}`;
        }
      }
    }
    update();
    closePicker();
  }

  function renderPickerCards(){
    if(!pickerList || !pickerCtx) return;
    const q = String(pickerSearch?.value||'').trim().toLowerCase();
    const set = String(pickerSet?.value||'').trim();
    const src = pickerCtx.kind==='monster' ? monsterCards : battleCards;
    const filtered = src.filter(c=>{
      if(set && c.set!==set) return false;
      if(!q) return true;
      const hay = `${c.name} ${c.id}`.toLowerCase();
      return hay.includes(q);
    });

    if(!filtered.length){
      pickerList.innerHTML = '<div style="opacity:.7;padding:8px;">該当カードがありません</div>';
      return;
    }

    const groups = new Map();
    filtered.forEach(c=>{
      const k=c.set||'OTHER';
      if(!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    });

    const order = (typeof getAvailableSetsOrder==='function')
      ? getAvailableSetsOrder().filter(k=>groups.has(k))
      : Array.from(groups.keys()).sort((a,b)=>a.localeCompare(b,'ja'));
    pickerList.innerHTML = order.map(setKey=>{
      const cards = groups.get(setKey)||[];
      const thumbs = cards.map(c=>`<button class="tcPickThumb" type="button" data-card-id="${c.id}"><img src="${c.src}" alt="${c.name}" onerror="this.onerror=null;this.src='${WHITE_BACK}';"><span class="name">${c.name}</span></button>`).join('');
      return `<section class="tcPickerGroup"><h4>${setKey}</h4><div class="tcPickerGrid">${thumbs}</div></section>`;
    }).join('');

    pickerList.querySelectorAll('.tcPickThumb[data-card-id]').forEach((btn)=>{
      btn.onclick=()=>{
        const info=getInfo(btn.dataset.cardId||'');
        if(info) applyPickedCard(info);
      };
    });
  }

  function openPicker(kind, index=0){
    if(!picker) return;
    pickerCtx = { kind, index };
    picker.classList.remove('hidden');
    if(pickerTitle){
      pickerTitle.textContent = kind==='monster' ? '怪獣カードを選択' : `交戦${index+1}のカードを選択`;
    }
    renderSets(kind==='monster' ? monsterCards : battleCards);
    if(pickerSearch) pickerSearch.value='';
    if(pickerSet) pickerSet.value='';
    renderPickerCards();
  }

  const n=(el)=>{
    const v=Number(el && el.value ? el.value : 0);
    return Number.isFinite(v) ? v : 0;
  };

  const update=()=>{
    const monsterInfo=getInfo(picked.monster);
    const monsterBase=monsterInfo ? (Number.isFinite(monsterInfo.power) ? monsterInfo.power : 0) : 0;
    if(monsterImg){
      monsterImg.src=(monsterInfo && monsterInfo.src) ? monsterInfo.src : toolFallbackSrc;
    }
    if(monsterNameEl){
      monsterNameEl.textContent = monsterInfo ? monsterInfo.name : '未選択';
    }
    if(monsterBaseEl){
      monsterBaseEl.textContent = `素:${__fmt(monsterBase)}`;
    }
    if(monsterPickBtn){
      monsterPickBtn.textContent = monsterInfo ? `怪獣: ${monsterInfo.name}` : '怪獣カードを選ぶ';
    }

    const threat=monsterBase + (n(rageEl)*5000) + n(monsterCounterEl);

    let repel=n(strategyCounterEl);
    const rows=battleList.querySelectorAll('.tcBattleRow');
    rows.forEach((row, idx)=>{
      const imgEl=row.querySelector('img[data-tc="battleImg"]');
      const baseEl=row.querySelector('[data-tc="battleBase"]');
      const counterEl=row.querySelector('input[data-tc="battleCounter"]');
      const pickBtn=row.querySelector('button[data-tc="battlePick"]');
      const info=getInfo(picked.battles[idx]);
      const base=info ? (Number.isFinite(info.power) ? info.power : 0) : 0;
      if(baseEl) baseEl.textContent=`素:${__fmt(base)}`;
      if(imgEl) imgEl.src=(info && info.src) ? info.src : toolFallbackSrc;
      if(pickBtn) pickBtn.textContent = info ? info.name : `交戦${idx+1}: カードを選ぶ`;
      repel += base + n(counterEl);
    });

    const diff=repel-threat;
    threatEl.textContent=__fmt(threat);
    repelEl.textContent=__fmt(repel);
    diffEl.textContent=__fmt(diff);
  };

  const monsterChosen=document.getElementById('tcMonsterChosen');
  const openMonsterPicker=()=>openPicker('monster',0);
  if(monsterPickBtn){ monsterPickBtn.onclick=openMonsterPicker; }
  if(monsterChosen){
    monsterChosen.onclick=openMonsterPicker;
    monsterChosen.onkeydown=(e)=>{
      if(e.key==='Enter' || e.key===' '){
        e.preventDefault();
        openMonsterPicker();
      }
    };
  }
  battleList.querySelectorAll('button[data-tc="battlePick"]').forEach((btn)=>{
    btn.onclick=()=>{
      const idx = Number(btn.dataset.slot||0);
      openPicker('battle', idx);
    };
  });
  if(pickerClose) pickerClose.onclick=closePicker;
  if(picker) picker.addEventListener('mousedown', (e)=>{ if(e.target===picker) closePicker(); });
  if(pickerSearch) pickerSearch.oninput=renderPickerCards;
  if(pickerSet) pickerSet.oninput=renderPickerCards;

  [rageEl,monsterCounterEl,strategyCounterEl].forEach(el=>{ if(el) el.oninput=update; });
  battleList.querySelectorAll('input').forEach(el=>{ el.oninput=update; });
  battleList.querySelectorAll('img[data-tc="battleImg"]').forEach(img=>{ img.onerror=()=>{ img.src=WHITE_BACK; }; });

  if(!initThreatCalcTool._escBound){
    document.addEventListener('keydown',(e)=>{
      if(e.key!=='Escape') return;
      if(picker && !picker.classList.contains('hidden')){
        e.preventDefault();
        closePicker();
      }
    });
    initThreatCalcTool._escBound = true;
  }

  update();
}


function openToolsModal(){
  if(startModal) startModal.style.display='none';
  if(toolsModal){
    toolsModal.classList.remove('hidden');
    toolsModal.style.display='flex';
  }
}
function closeToolsModal(){
  if(toolsModal){
    toolsModal.classList.add('hidden');
    toolsModal.style.removeProperty('display');
  }
}
function openThreatCalcModal(){
  if(startModal) startModal.style.display='none';
  if(toolsModal){
    toolsModal.classList.add('hidden');
    toolsModal.style.removeProperty('display');
  }
  if(threatCalcModal){
    threatCalcModal.classList.remove('hidden');
    threatCalcModal.style.display='flex';
  }
  initThreatCalcTool();
}
function closeThreatCalcModal(){
  if(threatCalcModal){
    threatCalcModal.classList.add('hidden');
    threatCalcModal.style.removeProperty('display');
  }
  const picker=document.getElementById('tcCardPicker');
  if(picker) picker.classList.add('hidden');
}

let areaCounterLeftNumber=1;
let areaCounterRightNumber=1;
let areaCounterFlipped=false;
let areaCounterPickingTarget=null;

function initAreaCounterTool(){
  if(!acLeftNumberCircle || !acRightNumberCircle) return;
  const numBtns=[...document.querySelectorAll('.acNumBtn')];
  const update=()=>{
    acLeftNumberCircle.textContent=String(areaCounterLeftNumber);
    acRightNumberCircle.textContent=String(areaCounterRightNumber);
    acLeftNumberCircle.classList.toggle('isFlipped', !!areaCounterFlipped);
    acRightNumberCircle.classList.toggle('isFlipped', !!areaCounterFlipped);
  };
  const openPicker=(target)=>{
    areaCounterPickingTarget = (target==='right') ? 'right' : 'left';
    if(acNumberPicker) acNumberPicker.classList.remove('hidden');
  };
  const closePicker=()=>{
    if(acNumberPicker) acNumberPicker.classList.add('hidden');
    areaCounterPickingTarget = null;
  };

  if(acLeftNumberCircle.dataset.bound!=='1'){
    acLeftNumberCircle.dataset.bound='1';
    acLeftNumberCircle.addEventListener('click',()=>openPicker('left'));
  }
  if(acRightNumberCircle.dataset.bound!=='1'){
    acRightNumberCircle.dataset.bound='1';
    acRightNumberCircle.addEventListener('click',()=>openPicker('right'));
  }
  numBtns.forEach((btn)=>{
    if(btn.dataset.bound==='1') return;
    btn.dataset.bound='1';
    btn.addEventListener('click',()=>{
      const n=Math.min(8,Math.max(1, Number(btn.dataset.areaNum)||1));
      if(areaCounterPickingTarget==='right') areaCounterRightNumber=n;
      else areaCounterLeftNumber=n;
      update();
      closePicker();
    });
  });
  if(btnAreaCounterFlip && btnAreaCounterFlip.dataset.bound!=='1'){
    btnAreaCounterFlip.dataset.bound='1';
    btnAreaCounterFlip.addEventListener('click',()=>{
      areaCounterFlipped=!areaCounterFlipped;
      update();
    });
  }
  if(acNumberPicker && acNumberPicker.dataset.bound!=='1'){
    acNumberPicker.dataset.bound='1';
    acNumberPicker.addEventListener('click',(e)=>{
      if(e.target===acNumberPicker) closePicker();
    });
  }

  update();
}

function openAreaCounterModal(){
  if(startModal) startModal.style.display='none';
  if(toolsModal){
    toolsModal.classList.add('hidden');
    toolsModal.style.removeProperty('display');
  }
  if(areaCounterModal){
    areaCounterModal.classList.remove('hidden');
    areaCounterModal.style.display='flex';
  }
  initAreaCounterTool();
}
function closeAreaCounterModal(){
  if(areaCounterModal){
    areaCounterModal.classList.add('hidden');
    areaCounterModal.style.removeProperty('display');
  }
  if(acNumberPicker) acNumberPicker.classList.add('hidden');
  areaCounterPickingTarget=null;
}

btnStartBuild.onclick=()=>{closeToolsModal();closeThreatCalcModal();closeAreaCounterModal();startModal.style.display='none';openBuilder();};
btnStartPlay.onclick=()=>{closeToolsModal();closeThreatCalcModal();closeAreaCounterModal();startModal.style.display='none';toolbar.classList.remove('hidden');setPlayModeUI(true);lastCoin=null;updateCoinUI();autoLoadBackImage();};
if(btnStartTools) btnStartTools.onclick=()=>{ openToolsModal(); };
if(btnToolsBack) btnToolsBack.onclick=()=>{ closeToolsModal(); if(startModal) startModal.style.display='flex'; };
if(btnToolThreatCalc) btnToolThreatCalc.onclick=()=>{ openThreatCalcModal(); };
if(btnToolAreaCounter) btnToolAreaCounter.onclick=()=>{ openAreaCounterModal(); };
if(btnThreatCalcClose) btnThreatCalcClose.onclick=()=>{ goBackToMode(); };
if(btnAreaCounterClose) btnAreaCounterClose.onclick=()=>{ goBackToMode(); };
if(btnAreaCounterClosePortrait) btnAreaCounterClosePortrait.onclick=()=>{ goBackToMode(); };
function goBackToMode(){if(revealIsOpen()) cancelReveal(); closeToolsModal(); closeThreatCalcModal(); closeAreaCounterModal(); toolbar.classList.add('hidden');setPlayModeUI(false);viewer.classList.add('hidden');preview.classList.add('hidden');builder.classList.add('hidden');startModal.style.display='flex';}


// ===== embed instance (used by solo mode iframes) =====
if(IS_EMBED){
  try{ startModal.style.display='none'; }catch(e){}
  try{ builder.classList.add('hidden'); }catch(e){}
  try{ toolbar.classList.add('hidden'); }catch(e){}
  setPlayModeUI(false);
  try{ if(btnBackToMode) btnBackToMode.style.display='none'; }catch(e){}
  try{ if(btnStartBuild) btnStartBuild.style.display='none'; }catch(e){}
  try{ if(btnStartTools) btnStartTools.style.display='none'; }catch(e){}
  // keep toolbars in embedded instances, but hide spectator button (not needed)
  try{ if(btnOpenSpectator) btnOpenSpectator.style.display='none'; }catch(e){}
  // reset meta UI
  try{ lastCoin=null; updateCoinUI(); }catch(e){}
  try{ autoLoadBackImage(); }catch(e){}
  // deck init from parent
  window.addEventListener('message',(ev)=>{
    const d=ev.data;
    if(!d || typeof d!=='object') return;
    if(d.type==='SOLO_INIT_DECK' && d.deck){
      try{ applyDeckAndStart(d.deck); }catch(e){ console.error(e); }
      return;
    }
    if(d.type==='SOLO_SET_META'){
      try{if('coin' in d){
          lastCoin = d.coin ? String(d.coin) : null;
          updateCoinUI();
        }
      }catch(e){ console.error(e); }
      return;
    }
        // counter commands from solo root
    if(d.type==='SOLO_COUNTER_OPEN'){
      try{ openCounterSelector(); }catch(e){ console.error(e); }
      return;
    }
    if(d.type==='SOLO_COUNTER_ADD'){
      try{ if('val' in d){ applyCounterToSelection(Number(d.val)||0); } }catch(e){ console.error(e); }
      return;
    }
    if(d.type==='SOLO_COUNTER_CLEAR'){
      try{ clearCounterOnSelection(); }catch(e){ console.error(e); }
      return;
    }
if(d.type==='SOLO_CMD' && d.targetId){
      try{
        const tid = String(d.targetId);
        // select
        if(tid==='deckReturnPos'){
          const sel = document.getElementById(tid);
          const v = (d.payload && typeof d.payload.value==='string') ? d.payload.value : '';
          if(sel && v) sel.value = v;
          if(sel) sel.dispatchEvent(new Event('change', {bubbles:true}));
          return;
        }

        const el = document.getElementById(tid);
        if(el){
          if(typeof el.onclick === 'function') el.onclick();
          else if(typeof el.click === 'function') el.click();
        }else{
          // 予備：IDが取れない場合のフォールバック
          if(tid==='OPEN_SPECTATOR' && typeof openSpectatorWindow==='function') openSpectatorWindow();
        }
      }catch(e){ console.error(e); }
      return;
    }
  });
  try{ window.parent && window.parent.postMessage({type:'SOLO_READY', flip:!!FLIP_LAYOUT}, '*'); }catch(e){}
}


// ===== 自動裏面読み込み =====
// undoで「裏面が白に戻る」を防ぐため、auto読み込み成功時は undo履歴内の backSrc を同期する
function patchUndoBackSrc(src){
  try{
    if(!state || !state.undoStack) return;
    state.undoStack = state.undoStack.map(s=>{
      try{ const o = JSON.parse(s); o.backSrc = src; return JSON.stringify(o); }
      catch(e){ return s; }
    });
  }catch(e){}
}
function autoLoadBackImage(){
  // すでにユーザーが裏面を指定している場合は上書きしない
  if(backSrc && backSrc !== WHITE_BACK) return;

  const path = `${CARD_FOLDER}/裏面.png`;
  const img = new Image();
  img.onload = ()=>{
    backSrc = path;
    updateBackImages();
    patchUndoBackSrc(backSrc); // ここが重要：過去スナップの backSrc も合わせる
  };
  img.onerror = ()=>{
    // 自動読み込み失敗時は現状維持（初期状態ならWHITE_BACKのまま）
    if(!backSrc) backSrc = WHITE_BACK;
  };
  img.src = path;
}


let __buildToastTimer = null;
function getCardLabelById(id){
  const card = CARD_DB.find(c=>c.id===id);
  return (card && (card.name || card.id)) ? (card.name || card.id) : String(id||'');
}
function showBuildToast(message){
  if(!buildToast) return;
  buildToast.textContent = message;
  buildToast.classList.add('show');
  if(__buildToastTimer) clearTimeout(__buildToastTimer);
  __buildToastTimer = setTimeout(()=>{
    buildToast.classList.remove('show');
  }, 1800);
}

// ===== Deck Builder =====
let buildMain={},buildMon={};
// --- Deck Save/Load (構築モード) ---
const DECKS_KEY='go_decks_v1';
let activeDeckId=null;
let activeDeckSnapshot='';

function deckFingerprint(deck){
  const normalize=(obj)=>Object.keys(obj||{}).sort().map(k=>`${k}:${obj[k]||0}`).join('|');
  return `M:${normalize(deck?.main||{})}#K:${normalize(deck?.monster||{})}`;
}
function syncActiveDeckSnapshot(){
  if(!activeDeckId){ activeDeckSnapshot=''; return; }
  activeDeckSnapshot = deckFingerprint(currentDeckObj());
}
function isActiveDeckDirty(){
  if(!activeDeckId || !activeDeckSnapshot) return false;
  return deckFingerprint(currentDeckObj()) !== activeDeckSnapshot;
}
function askSaveBeforeDestructiveChange(message){
  const mCnt=sumObj(buildMain), kCnt=sumObj(buildMon);
  if(mCnt===0 && kCnt===0) return true;
  if(confirm(`${message}\n\nOK: セーブする / キャンセル: 次へ`)){
    const before = deckFingerprint(currentDeckObj());
    saveDeckPrompt();
    const after = deckFingerprint(currentDeckObj());
    if(before===after && isActiveDeckDirty()) return false;
    return true;
  }
  return confirm('保存せずに続行しますか？');
}

function safeJSONParse(s,fallback){
  try{ const v=JSON.parse(s); return (v===null||v===undefined)?fallback:v; }catch(e){ return fallback; }
}
function getDeckSaves(){
  const raw=localStorage.getItem(DECKS_KEY);
  if(!raw) return [];
  const v=safeJSONParse(raw,[]);
  if(Array.isArray(v)) return v;
  if(v && Array.isArray(v.decks)) return v.decks;
  return [];
}
function setDeckSaves(decks){
  try{ localStorage.setItem(DECKS_KEY, JSON.stringify(decks)); }catch(e){ alert('保存容量オーバーの可能性があります'); }
}
function newId(){
  try{ return crypto.randomUUID(); }catch(e){}
  return 'd_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
}
function cloneDeckObj(obj){
  const main = Object.assign({}, obj?.main||{});
  const monster = Object.assign({}, obj?.monster||{});
  return {main, monster};
}
function currentDeckObj(){ return {main:Object.assign({},buildMain), monster:Object.assign({},buildMon)}; }

function fmtJP(iso){
  try{
    const d=new Date(iso);
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,'0');
    const da=String(d.getDate()).padStart(2,'0');
    const hh=String(d.getHours()).padStart(2,'0');
    const mm=String(d.getMinutes()).padStart(2,'0');
    return `${y}/${m}/${da} ${hh}:${mm}`;
  }catch(e){ return ''; }
}

function applyDeckToBuilder(deck, opts={}){
  buildMain = Object.assign({}, deck?.main||{});
  buildMon  = Object.assign({}, deck?.monster||{});
  renderDeckThumbs();
  updateBuildCount();
  try{ deckCodeBox.value = encodeDeck({main:buildMain, monster:buildMon}); }catch(e){}
  if(opts && opts.syncSnapshot) syncActiveDeckSnapshot();
}

function saveDeckPrompt(){
  const defaultName = (()=> {
    const decks=getDeckSaves();
    const cur = activeDeckId ? decks.find(d=>d.id===activeDeckId) : null;
    return cur?.name || '';
  })();
  const name = prompt('デッキ名を入力してください', defaultName);
  if(!name) return;

  const deck = currentDeckObj();
  const now = new Date().toISOString();
  const decks = getDeckSaves();

  // 完成してない場合は一応確認
  const mCnt=sumObj(buildMain), kCnt=sumObj(buildMon);
  if((mCnt!==MAIN_LIMIT || kCnt!==MON_LIMIT) && !confirm(`枚数が未完成です（メイン ${mCnt}/${MAIN_LIMIT}・怪獣 ${kCnt}/${MON_LIMIT}）。このまま保存しますか？`)){
    return;
  }

  // 同名があれば上書き（最初にヒットしたもの）
  const sameName = decks.find(d=>String(d.name||'')===String(name));
  if(sameName){
    sameName.deck = cloneDeckObj(deck);
    sameName.updatedAt = now;
    activeDeckId = sameName.id;
    setDeckSaves(decks);
    syncActiveDeckSnapshot();
    alert('上書き保存しました');
    return;
  }

  // 既にロード中のデッキがあるなら、それを更新するか新規かを選べるようにする
  if(activeDeckId){
    const cur = decks.find(d=>d.id===activeDeckId);
    if(cur && confirm('ロード中のデッキを更新しますか？（キャンセルで新規保存）')){
      cur.name = name;
      cur.deck = cloneDeckObj(deck);
      cur.updatedAt = now;
      setDeckSaves(decks);
      syncActiveDeckSnapshot();
      alert('更新保存しました');
      return;
    }
  }

  const entry = { id:newId(), name:String(name), deck:cloneDeckObj(deck), createdAt:now, updatedAt:now };
  decks.unshift(entry);
  activeDeckId = entry.id;
  setDeckSaves(decks);
  syncActiveDeckSnapshot();
  alert('保存しました（デッキ一覧に追加）');
}

function openDeckMgr(){
  deckMgr.classList.remove('hidden');
  deckMgrSearch.value = '';
  renderDeckMgr();
  setTimeout(()=>deckMgrSearch.focus(), 0);
}
function closeDeckMgr(){ deckMgr.classList.add('hidden'); }

function renderDeckMgr(){
  const q = (deckMgrSearch.value||'').trim().toLowerCase();
  const decks = getDeckSaves().slice().sort((a,b)=>{
    const ta = Date.parse(a.updatedAt||a.createdAt||0) || 0;
    const tb = Date.parse(b.updatedAt||b.createdAt||0) || 0;
    return tb-ta;
  });
  const filtered = q ? decks.filter(d=>String(d.name||'').toLowerCase().includes(q)) : decks;

  deckMgrList.innerHTML='';
  filtered.forEach(d=>{
    const div=document.createElement('div');
    div.className='deckItem';
    const mCnt = sumObj(d.deck?.main||{});
    const kCnt = sumObj(d.deck?.monster||{});
    const when = fmtJP(d.updatedAt||d.createdAt||'');
    div.innerHTML = `
      <div class="deckMeta">
        <div class="deckName">${escapeHtml(d.name||'(no name)')}</div>
        <div class="deckInfo">メイン ${mCnt}/${MAIN_LIMIT} ・ 怪獣 ${kCnt}/${MON_LIMIT}${when?(' ・ 更新 '+when):''}</div>
      </div>
      <div class="deckActions">
        <button data-act="load" data-id="${escapeHtml(d.id)}">ロード</button>
        <button data-act="rename" data-id="${escapeHtml(d.id)}">名前</button>
        <button data-act="delete" data-id="${escapeHtml(d.id)}">削除</button>
      </div>
    `;
    deckMgrList.appendChild(div);
  });

  deckMgrCount.textContent = String(filtered.length);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function downloadDeckSaves(){
  const decks = getDeckSaves();
  const payload = { version: 1, exportedAt: new Date().toISOString(), decks };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  const ts = (()=>{const d=new Date();const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;})();
  a.download = `go_deck_saves_${ts}.json`;
  a.href = URL.createObjectURL(blob);
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},0);
}

function mergeDecks(existing, incoming){
  const byId = new Map();
  existing.forEach(d=>{ if(d && d.id) byId.set(d.id, d); });
  incoming.forEach(d=>{
    if(!d) return;
    if(!d.id) d.id = newId();
    if(!d.name) d.name = '(no name)';
    if(!d.deck) d.deck = {main:{}, monster:{}};
    const prev = byId.get(d.id);
    byId.set(d.id, Object.assign(prev||{}, d, { deck: cloneDeckObj(d.deck) }));
  });
  return Array.from(byId.values()).sort((a,b)=>{
    const ta = Date.parse(a.updatedAt||a.createdAt||0) || 0;
    const tb = Date.parse(b.updatedAt||b.createdAt||0) || 0;
    return tb-ta;
  });
}

async function importDeckSavesFile(file){
  const text = await file.text();
  const v = safeJSONParse(text, null);
  if(!v){ alert('ファイル形式が不正です'); return; }

  let incoming = null;
  if(Array.isArray(v)) incoming = v;
  else if(v && Array.isArray(v.decks)) incoming = v.decks;
  else incoming = null;

  if(!incoming){ alert('このJSONにデッキ一覧が見つかりません'); return; }

  const merged = mergeDecks(getDeckSaves(), incoming);
  setDeckSaves(merged);
  alert(`取り込み完了：${incoming.length} 件`);
  renderDeckMgr();
}

// wiring
btnDeckSave && (btnDeckSave.onclick = ()=>saveDeckPrompt());
btnDeckLoad && (btnDeckLoad.onclick = ()=>openDeckMgr());
btnDeckReset && (btnDeckReset.onclick = ()=>{
  const ok = askSaveBeforeDestructiveChange('現在のデッキをリセットします。リセット前にセーブしますか？');
  if(!ok) return;
  buildMain={};
  buildMon={};
  activeDeckId=null;
  activeDeckSnapshot='';
  renderDeckThumbs();
  updateBuildCount();
  try{ deckCodeBox.value=''; }catch(e){}
});
btnDeckDownload && (btnDeckDownload.onclick = ()=>downloadDeckSaves());
btnDeckMgrClose && (btnDeckMgrClose.onclick = ()=>closeDeckMgr());
btnDeckMgrDownload && (btnDeckMgrDownload.onclick = ()=>downloadDeckSaves());
deckMgrSearch && deckMgrSearch.addEventListener('input', renderDeckMgr);

deckMgr && deckMgr.addEventListener('mousedown', (e)=>{ if(e.target===deckMgr) closeDeckMgr(); });
deckMgrList && deckMgrList.addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-act]');
  if(!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  const decks = getDeckSaves();
  const d = decks.find(x=>String(x.id)===String(id));
  if(act==='load'){
    if(!d){ alert('デッキが見つかりません'); renderDeckMgr(); return; }
    if(activeDeckId && activeDeckId!==d.id && isActiveDeckDirty()){
      const ok = askSaveBeforeDestructiveChange('現在のロード済みデッキが変更されています。別のデッキをロードする前にセーブしますか？');
      if(!ok) return;
    }
    activeDeckId = d.id;
    applyDeckToBuilder(d.deck, {syncSnapshot:true});
    closeDeckMgr();
    return;
  }
  if(act==='rename'){
    if(!d) return;
    const newName = prompt('新しいデッキ名', d.name||'');
    if(!newName) return;
    // 同名チェック（別IDの同名があれば上書きになるのを避けるため）
    const conflict = decks.find(x=>x.id!==d.id && String(x.name||'')===String(newName));
    if(conflict && !confirm('同名のデッキがあります。名前をそのまま変更しますか？')){
      return;
    }
    d.name = String(newName);
    d.updatedAt = new Date().toISOString();
    setDeckSaves(decks);
    renderDeckMgr();
    return;
  }
  if(act==='delete'){
    if(!d) return;
    if(!confirm(`「${d.name||'(no name)'}」を削除しますか？`)) return;
    const next = decks.filter(x=>x.id!==d.id);
    setDeckSaves(next);
    if(activeDeckId===d.id){ activeDeckId=null; activeDeckSnapshot=''; }
    renderDeckMgr();
  }
});

if(deckUploadInput){
  deckUploadInput.addEventListener('change', async (e)=>{
    const f = deckUploadInput.files && deckUploadInput.files[0];
    deckUploadInput.value = '';
    if(!f) return;
    try{
      await importDeckSavesFile(f);
    }catch(err){
      alert('読み込みに失敗しました');
    }
  });
}


let libSetFilter='__ALL__'; // '__ALL__' = 全表示

function getAvailableSets(){
  const s = new Set(CARD_DB.map(c=>c.set).filter(x=>x && x!=='OTHER'));
  const baseOrder=['SD1','SD2','BP01','BP02','BP03','BP04','FC01','PR'];
  const rest=[...s].filter(k=>!baseOrder.includes(k)).sort((a,b)=>a.localeCompare(b,'ja'));
  return [...baseOrder.filter(k=>s.has(k)), ...rest];
}

function updateSetBarActive(){
  if(!libSetBar) return;
  [...libSetBar.querySelectorAll('.setBtn')].forEach(btn=>{
    btn.classList.toggle('active', (btn.dataset.set||'')===libSetFilter);
  });
  if(libSetCurrent){
    libSetCurrent.textContent = (libSetFilter==='__ALL__') ? 'すべて' : (libSetFilter||'すべて');
  }
}


// collapsible set bar (deck builder)
function setSetBarCollapsed(collapsed){
  if(!libSetSection) return;
  libSetSection.classList.toggle('collapsed', !!collapsed);
  if(libSetHeader) libSetHeader.setAttribute('aria-expanded', (!collapsed).toString());
  try{ localStorage.setItem('libSetBarCollapsed', collapsed ? '1' : '0'); }catch(e){}
}
function loadSetBarCollapsed(){
  let v=null;
  try{ v = localStorage.getItem('libSetBarCollapsed'); }catch(e){}
  if(v===null) return; // default: expanded
  setSetBarCollapsed(v==='1');
}

function setBuilderFooterCollapsed(collapsed){
  if(!builderFooter) return;
  builderFooter.classList.toggle('collapsed', !!collapsed);
  if(builderFooterHeader) builderFooterHeader.setAttribute('aria-expanded', (!collapsed).toString());
  try{ localStorage.setItem('builderFooterCollapsed', collapsed ? '1' : '0'); }catch(e){}
}
function loadBuilderFooterCollapsed(){
  let v=null;
  try{ v = localStorage.getItem('builderFooterCollapsed'); }catch(e){}
  if(v===null) return; // default: expanded
  setBuilderFooterCollapsed(v==='1');
}
if(btnLibSetToggle){
  btnLibSetToggle.addEventListener('click', (e)=>{ e.stopPropagation(); setSetBarCollapsed(!libSetSection.classList.contains('collapsed')); });
}
if(libSetHeader){
  libSetHeader.addEventListener('click', ()=>{ setSetBarCollapsed(!libSetSection.classList.contains('collapsed')); });
  libSetHeader.addEventListener('keydown', (e)=>{
    if(e.key==='Enter' || e.key===' '){
      e.preventDefault();
      setSetBarCollapsed(!libSetSection.classList.contains('collapsed'));
    }
  });
}
if(btnBuilderFooterToggle){
  btnBuilderFooterToggle.addEventListener('click', (e)=>{
    e.stopPropagation();
    setBuilderFooterCollapsed(!builderFooter.classList.contains('collapsed'));
  });
}
if(builderFooterHeader){
  builderFooterHeader.addEventListener('click', ()=>{ setBuilderFooterCollapsed(!builderFooter.classList.contains('collapsed')); });
  builderFooterHeader.addEventListener('keydown', (e)=>{
    if(e.key==='Enter' || e.key===' '){
      e.preventDefault();
      setBuilderFooterCollapsed(!builderFooter.classList.contains('collapsed'));
    }
  });
}


function renderSetBar(){
  if(!libSetBar) return;
  libSetBar.innerHTML='';

  const makeBtn=(key,label,cls='')=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.className=('setBtn '+(cls||'')).trim();
    btn.dataset.set=key;

    if(key!=='__ALL__'){
      const img=document.createElement('img');
      img.alt=label||key;
      img.loading='lazy';
      img.decoding='async';

      const tries=[];
      // 期待する命名: BP{段数}.png / SD{種類(1or2)}.png / FC01.png（0埋め違いもフォールバック）
      tries.push(`${CARD_FOLDER}/${key}.png`);
      if(/^SD\d$/.test(key)) tries.push(`${CARD_FOLDER}/SD0${key.slice(2)}.png`);
      if(/^SD0\d$/.test(key)) tries.push(`${CARD_FOLDER}/SD${key.slice(3)}.png`);
      if(/^BP\d{2}$/.test(key)) tries.push(`${CARD_FOLDER}/BP${parseInt(key.slice(2),10)}.png`);
      if(/^BP\d$/.test(key)) tries.push(`${CARD_FOLDER}/BP0${key.slice(2)}.png`);
      if(/^FC\d{2}$/.test(key)) tries.push(`${CARD_FOLDER}/FC${parseInt(key.slice(2),10)}.png`);

      let i=0;
      const tryNext=()=>{
        if(i>=tries.length){
          img.remove();
          return;
        }
        img.src=tries[i++];
      };
      img.onerror=()=>{tryNext();};

      btn.appendChild(img);
      tryNext();
    }

    const span=document.createElement('span');
    span.className='setLabel';
    span.textContent=label||key;
    btn.appendChild(span);

    btn.addEventListener('click', ()=>{
      libSetFilter=key;
      updateSetBarActive();
      libList.scrollTop=0;
      renderLibrary();
    });
    return btn;
  };

  libSetBar.appendChild(makeBtn('__ALL__','すべて','all'));

  const sets=getAvailableSets();
  if(libSetFilter!=='__ALL__' && !sets.includes(libSetFilter)) libSetFilter='__ALL__';
  sets.forEach(k=>libSetBar.appendChild(makeBtn(k,k,'')));

  updateSetBarActive();
}


function setMobileBuilderView(mode='lib'){
  if(!builderMain) return;
  const view=(mode==='deck')?'deck':'lib';
  builderMain.dataset.mobileView=view;
  if(btnMobileShowLib){
    const active=view==='lib';
    btnMobileShowLib.classList.toggle('active', active);
    btnMobileShowLib.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  if(btnMobileShowDeck){
    const active=view==='deck';
    btnMobileShowDeck.classList.toggle('active', active);
    btnMobileShowDeck.setAttribute('aria-selected', active ? 'true' : 'false');
  }
}
function syncMobileBuilderUI(){
  if(!mobileBuilderTabs || !builderMain) return;
  const isMobile = window.matchMedia('(max-width: 768px), (display-mode: standalone) and (orientation: portrait), (orientation: portrait) and (pointer: coarse) and (max-width: 1024px)').matches;
  mobileBuilderTabs.classList.toggle('hidden', !isMobile);
  if(!isMobile){
    builderMain.dataset.mobileView='';
    return;
  }
  if(builderMain.dataset.mobileView!=='deck' && builderMain.dataset.mobileView!=='lib'){
    setMobileBuilderView('lib');
  }else{
    setMobileBuilderView(builderMain.dataset.mobileView);
  }
}
if(btnMobileShowLib) btnMobileShowLib.addEventListener('click', ()=>setMobileBuilderView('lib'));
if(btnMobileShowDeck) btnMobileShowDeck.addEventListener('click', ()=>setMobileBuilderView('deck'));
window.addEventListener('resize', syncMobileBuilderUI);

try{
  if(startVersion) startVersion.textContent = `ver ${APP_VERSION}`;
  document.title = `G-CARD Director ${APP_VERSION}`;
}catch(e){}

function openBuilder(){builder.classList.remove('hidden');renderSetBar();loadSetBarCollapsed();loadBuilderFooterCollapsed();renderLibrary();renderDeckThumbs();updateBuildCount();syncMobileBuilderUI();}
function closeBuilder(){builder.classList.add('hidden');}

function renderLibrary(){
  libList.innerHTML='';
  const q=libFilter.value?libFilter.value.toLowerCase():'';
  const setKey=libSetFilter||'__ALL__';
  const colorF = libColor && libColor.value ? String(libColor.value) : '';
  const typeF  = libType && libType.value ? String(libType.value) : '';
  const gradeF = libGrade && libGrade.value ? String(libGrade.value) : '';

  CARD_DB.forEach(card=>{
    if(setKey!=='__ALL__' && card.set!==setKey) return;

    const meta = getMetaById(card.id) || null;
    if(colorF && (!meta || String(meta.color||'')!==colorF)) return;
    if(typeF  && (!meta || String(meta.type||'')!==typeF)) return;
    if(gradeF && (!meta || String(meta.grade??'')!==gradeF)) return;

    const hay = (function(){
      const parts=[
        card.id,
        card.name,
        meta && meta.name,
        meta && meta.color,
        meta && meta.type,
        meta && meta.features_raw,
        meta && meta.text
      ].filter(Boolean).map(x=>String(x));
      return parts.join(' ').toLowerCase();
    })();
    if(q && !hay.includes(q)) return;

    const div=document.createElement('div');div.className='libCard';div.dataset.id=card.id;
    const img=document.createElement('img');img.src=card.srcGuess;img.onerror=()=>{img.src=WHITE_BACK;};div.appendChild(img);
    const btns=document.createElement('div');btns.className='libBtns';
    const bM=document.createElement('button');bM.textContent='＋メ';bM.onclick=(e)=>{e.stopPropagation();addToBuild(card.id,'main',1);};
    const bK=document.createElement('button');bK.textContent='＋怪';bK.onclick=(e)=>{e.stopPropagation();addToBuild(card.id,'monster',1);};
    btns.append(bM,bK);div.appendChild(btns);
    div.onclick=()=>{openPreviewByCardId(card.id);};
    libList.appendChild(div);
  });
}
libFilter.addEventListener('input',renderLibrary);
if(libColor) libColor.addEventListener('change',renderLibrary);
if(libType) libType.addEventListener('change',renderLibrary);
if(libGrade) libGrade.addEventListener('change',renderLibrary);

function addToBuild(id,which,count){const target=which==='monster'?buildMon:buildMain;target[id]=(target[id]||0)+count;renderDeckThumbs();updateBuildCount();const deckName=(which==='monster')?'怪獣デッキ':'メインデッキ';showBuildToast(`${deckName}に「${getCardLabelById(id)}」を追加`);}
function decFromBuild(id,which){const target=which==='monster'?buildMon:buildMain;if(!target[id])return;target[id]--;if(target[id]<=0)delete target[id];renderDeckThumbs();updateBuildCount();}
// ===== Deck Builder: sort order (怪獣→交戦→戦略, 等級昇順, 色:赤→青→緑→白, カードNo昇順) =====
const __BUILD_TYPE_RANK = {'怪獣':0,'交戦':1,'戦略':2};
const __BUILD_COLOR_RANK = {'赤':0,'青':1,'緑':2,'白':3};

function __buildNormId(id){ return String(id||'').replace(/ol$/i,''); }

function __buildTypeOf(id, which){
  if(which==='monster') return '怪獣';
  const m = getMetaById(id) || null;
  const t = String(m && m.type ? m.type : '');
  if(t.includes('怪獣')) return '怪獣';
  if(t.includes('交戦')) return '交戦';
  if(t.includes('戦略')) return '戦略';
  return t || '';
}
function __buildTypeRank(typeStr){
  return (__BUILD_TYPE_RANK[typeStr] != null) ? __BUILD_TYPE_RANK[typeStr] : 9;
}
function __buildGradeNum(id){
  const m = getMetaById(id) || null;
  const g = (m && m.grade != null && m.grade !== '') ? Number(m.grade) : NaN;
  return Number.isFinite(g) ? g : 999;
}
function __buildColorRank(id){
  const m = getMetaById(id) || null;
  const c = String(m && m.color ? m.color : '').trim();
  return (__BUILD_COLOR_RANK[c] != null) ? __BUILD_COLOR_RANK[c] : 9;
}
function __buildCardNoNum(id){
  const s = __buildNormId(id);
  // "BP04-001" / "SD01-015" / "PR-12" などを想定
  let mm = s.match(/-(\d+)(?!.*\d)/); // 末尾の数字塊（ハイフン区切り優先）
  if(!mm) mm = s.match(/(\d+)(?!.*\d)/); // 念のため最後の数字塊
  return mm ? parseInt(mm[1],10) : 999999;
}
function __buildSortEntries(which){
  return (a,b)=>{
    const ida=a[0], idb=b[0];
    const ta = __buildTypeRank(__buildTypeOf(ida, which));
    const tb = __buildTypeRank(__buildTypeOf(idb, which));
    if(ta!==tb) return ta-tb;

    const ga = __buildGradeNum(ida), gb = __buildGradeNum(idb);
    if(ga!==gb) return ga-gb;

    const ca = __buildColorRank(ida), cb = __buildColorRank(idb);
    if(ca!==cb) return ca-cb;

    const na = __buildCardNoNum(ida), nb = __buildCardNoNum(idb);
    if(na!==nb) return na-nb;

    // 最終安定化（同一Noなどのケース）
    return __buildNormId(ida).localeCompare(__buildNormId(idb), 'ja');
  };
}
function renderDeckThumbs(){
  gridMonster.innerHTML='';
  gridMain.innerHTML='';
  const buildSection=(obj,grid,which)=>{
    const entries = Object.entries(obj).sort(__buildSortEntries(which));
    entries.forEach(([id,num])=>{
      const info = CARD_DB.find(c=>c.id===id) || {srcGuess:WHITE_BACK,name:id,id};
      const wrap=document.createElement('div');
      wrap.className='deckThumb';
      wrap.dataset.id=id;

      const img=document.createElement('img');
      img.src=info.srcGuess;
      img.onerror=()=>{img.src = maskReveal ? revealBack : WHITE_BACK;};
      wrap.appendChild(img);

      const cnt=document.createElement('div');
      cnt.className='deckCnt';
      cnt.textContent='x'+num;
      wrap.appendChild(cnt);

      const ctrl=document.createElement('div');
      ctrl.className='ctrl';
      const plus=document.createElement('button');
      plus.textContent='＋';
      plus.addEventListener('click',(e)=>{e.stopPropagation(); addToBuild(id,which,1);});
      const minus=document.createElement('button');
      minus.textContent='－';
      minus.addEventListener('click',(e)=>{e.stopPropagation(); decFromBuild(id,which);});
      ctrl.append(plus,minus);
      wrap.appendChild(ctrl);

      // 右側（構築中デッキ）カードをクリック → 拡大表示
      wrap.addEventListener('click',()=>{
        openPreviewByCardId(id);
      });

      grid.appendChild(wrap);
    });
  };
  buildSection(buildMon,gridMonster,'monster');
  buildSection(buildMain,gridMain,'main');
}
function updateBuildCount(){const m=sumObj(buildMain),k=sumObj(buildMon);countInfo.textContent=`メイン ${m}/${MAIN_LIMIT}　怪獣 ${k}/${MON_LIMIT}`;btnBuildStart.disabled=!(m===MAIN_LIMIT&&k===MON_LIMIT);}
function sumObj(o){return Object.values(o).reduce((a,b)=>a+b,0);}
btnCodeGen.onclick=()=>{deckCodeBox.value=encodeDeck({main:buildMain,monster:buildMon});};



// ===== Hidden Command Codes (mobile-friendly) =====
// デッキコード欄 / QR の文字列にコマンドを入れて起動できる
// 例: "v2:cmd:2pick" / "cmd:2pick" / "2pick" / "g2pick"
function __is2PickCommand(str){
  if(!str) return false;
  const raw = String(str).trim();
  if(!raw) return false;
  const low = raw.toLowerCase();

  // accept when embedded in longer text (e.g. copied messages)
  if(low.includes('v2:cmd:2pick') || low.includes('v2:cmd:g2pick') || low.includes('v1:cmd:2pick') || low.includes('v1:cmd:g2pick')) return true;
  if(low.includes('cmd:2pick') || low.includes('cmd:g2pick')) return true;

  // strip deck-code version prefix if present
  const clean = low.replace(/^v[12]:/, '').trim();

  if(clean === '2pick' || clean === 'g2pick') return true;
  if(clean.startsWith('cmd:')){
    const cmd = clean.slice(4).trim();
    return (cmd === '2pick' || cmd === 'g2pick');
  }
  return false;
}

function __tryLaunch2PickFromCode(str){
  if(!__is2PickCommand(str)) return false;
  try{
    if(typeof window.openDraft2Pick === 'function') window.openDraft2Pick();
  }catch(e){}
  return true;
}
function makeDebugRandomDeck(){
  const idsAll = IDS.slice();
  const shuffle = (arr)=>{
    for(let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      const tmp=arr[i];arr[i]=arr[j];arr[j]=tmp;
    }
    return arr;
  };
  const pickUnique = (arr, n)=>{
    const a = shuffle(arr.slice());
    return a.slice(0, Math.min(n, a.length));
  };
  const isMonsterCandidate = (id)=>{
    try{
      const m=getMetaById(id);
      const t=String(m?.type||'');
      const d=String(m?.deck||'');
      return d==='monster' || t.includes('怪獣') || t.toLowerCase().includes('monster');
    }catch(e){ return false; }
  };

  const monCandidates = idsAll.filter(isMonsterCandidate);
  const monPick = pickUnique((monCandidates.length>=MON_LIMIT?monCandidates:idsAll), MON_LIMIT);

  const mainCandidates = idsAll.filter(id=>!monPick.includes(id));
  let mainPick = pickUnique((mainCandidates.length>=MAIN_LIMIT?mainCandidates:idsAll), MAIN_LIMIT);

  // 万一足りなければ重複OKで埋める
  while(mainPick.length<MAIN_LIMIT){
    mainPick.push(idsAll[Math.floor(Math.random()*idsAll.length)]);
  }

  const main={}; for(const id of mainPick){ main[id]=(main[id]||0)+1; }
  const monster={}; for(const id of monPick){ monster[id]=(monster[id]||0)+1; }
  return {main, monster};
}
btnCodeLoad.onclick=()=>{
  try{
    const raw = deckCodeBox.value.trim();
    // Mobile-friendly hidden command: paste a command-like "deck code" to launch 2Pick
    // e.g. v2:cmd:2pick
    if(__tryLaunch2PickFromCode(raw)) return;
    if(raw && raw.toLowerCase()==='kochavrendy'){
      const obj = makeDebugRandomDeck();
      buildMain=obj.main||{};
      buildMon=obj.monster||{};
      renderDeckThumbs();
      updateBuildCount();
      alert('デバッグ用：ランダムデッキを生成しました');
      return;
    }
    const obj=decodeDeck(raw);
    buildMain=obj.main||{};
    buildMon=obj.monster||{};
    renderDeckThumbs();
    updateBuildCount();
    alert('読込完了');
  }catch(e){
    alert('コードが不正です');
  }
};



// ===== Deck QR =====
function normalizeDeckCodeFromText(t){
  if(!t) return '';
  const s = String(t).trim();
  // accept v1 / v2 directly, or extract from longer text (e.g. pasted logs)
  if(s.startsWith('v1:') || s.startsWith('v2:')) return s;
  const i1 = s.indexOf('v1:');
  const i2 = s.indexOf('v2:');
  let i = -1;
  if(i1>=0 && i2>=0) i = Math.min(i1,i2);
  else i = (i1>=0 ? i1 : i2);
  if(i>=0) return s.slice(i).trim();
  return s;
}

let __qrCodeLibPromise = null;
function __loadScriptOnce(src){
  return new Promise((resolve,reject)=>{
    // already loaded?
    const exists = Array.from(document.scripts||[]).some(s=>s.src===src);
    if(exists) return resolve(true);
    const s=document.createElement('script');
    s.src=src;
    s.async=true;
    s.onload=()=>resolve(true);
    s.onerror=()=>reject(new Error('load failed: '+src));
    document.head.appendChild(s);
  });
}
async function __ensureQRCodeLib(){
  if(window.QRCode && QRCode.toCanvas) return true;
  if(__qrCodeLibPromise) return __qrCodeLibPromise;
  const urls=[
    'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js',
    'https://unpkg.com/qrcode@1.5.4/build/qrcode.min.js'
  ];
  __qrCodeLibPromise=(async ()=>{
    for(const u of urls){
      try{
        await __loadScriptOnce(u);
        if(window.QRCode && QRCode.toCanvas) return true;
      }catch(e){ /* try next */ }
    }
    return false;
  })();
  return __qrCodeLibPromise;
}

function __showQrFallbackImage(code){
  if(!qrCanvas) return;
  const img = document.getElementById('qrImg');
  // Hide canvas, show img
  qrCanvas.style.display='none';
  if(img){
    img.style.display='block';
    img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=320x320&ecc=M&margin=1&data=' + encodeURIComponent(code);
    img.onerror = ()=>{
      // If even this fails, show a clear message on canvas
      try{
        qrCanvas.style.display='block';
        img.style.display='none';
        const ctx=qrCanvas.getContext('2d');
        ctx.clearRect(0,0,qrCanvas.width,qrCanvas.height);
        ctx.fillStyle='#fff';ctx.fillRect(0,0,qrCanvas.width,qrCanvas.height);
        ctx.fillStyle='#000';ctx.font='14px sans-serif';
        ctx.fillText('QR生成に失敗しました',10,30);
        ctx.fillText('通信環境を確認してください',10,55);
      }catch(e){}
    };
  }
}


function __qrRenderCssSize(){
  // Big enough for dense deck codes; keep within viewport
  const vw = Math.max(320, Math.floor(window.innerWidth * 0.86));
  const vh = Math.max(320, Math.floor(window.innerHeight * 0.70));
  // Aim for a square that fits comfortably in the modal
  return Math.max(360, Math.min(760, vw, vh));
}
function __qrRenderWidthPx(){
  const css = __qrRenderCssSize();
  const dpr = window.devicePixelRatio || 1;
  return Math.max(360, Math.floor(css * dpr));
}
function __prepQrCanvasSize(){
  if(!qrCanvas) return;
  const css = __qrRenderCssSize();
  const px  = __qrRenderWidthPx();
  qrCanvas.width = px;
  qrCanvas.height = px;
  qrCanvas.style.width = css + 'px';
  qrCanvas.style.height = css + 'px';
}

async function openQrModalWithCode(code){
  if(!qrModal||!qrCanvas||!qrText) return;
  const c=normalizeDeckCodeFromText(code);
  qrText.value=c;

  qrModal.classList.remove('hidden');
  __prepQrCanvasSize();

  // render QR (prefer local lib; fallback to external image)
  try{
    const ok = await __ensureQRCodeLib();
    const img = document.getElementById('qrImg');
    if(ok && window.QRCode && QRCode.toCanvas){
      // show canvas, hide img
      qrCanvas.style.display='block';
      if(img) img.style.display='none';
      QRCode.toCanvas(qrCanvas, c, {errorCorrectionLevel:'L', margin:4, width:__qrRenderWidthPx()}, (err)=>{
        if(err) console.warn(err);
      });
      return;
    }
    // fallback image service
    __showQrFallbackImage(c);
  }catch(e){
    console.warn(e);
    __showQrFallbackImage(c);
  }
}

function closeQrModal(){ qrModal && qrModal.classList.add('hidden'); }
btnQrClose && (btnQrClose.onclick=closeQrModal);
qrModal && qrModal.addEventListener('click', e=>{ if(e.target===qrModal) closeQrModal(); });

btnQrCopy && (btnQrCopy.onclick=async ()=>{
  try{
    await navigator.clipboard.writeText(qrText.value||'');
    alert('コピーしました');
  }catch(e){
    // fallback
    try{
      qrText.focus(); qrText.select();
      document.execCommand('copy');
      alert('コピーしました');
    }catch(e2){ alert('コピーに失敗しました'); }
  }
});

async function decodeQrFromImageFile(file){
  if(!file) return null;
  if(typeof jsQR==='undefined') return null;

  const MAX_SIDE = 1400; // 大きすぎる画像は縮小して高速化
  let source = null;
  let objectUrl = null;

  // createImageBitmapが使えるならEXIF向きも反映されやすい
  try{
    if('createImageBitmap' in window){
      source = await createImageBitmap(file, { imageOrientation:'from-image' });
    }
  }catch(e){ /* fallback below */ }

  if(!source){
    objectUrl = URL.createObjectURL(file);
    source = await new Promise((resolve, reject)=>{
      const img = new Image();
      img.onload = ()=> resolve(img);
      img.onerror = reject;
      img.src = objectUrl;
    });
  }

  const w0 = source.width || source.videoWidth || source.naturalWidth;
  const h0 = source.height || source.videoHeight || source.naturalHeight;
  if(!w0 || !h0) return null;

  const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));

  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d', { willReadFrequently:true });
  ctx.drawImage(source, 0, 0, w, h);

  // object URL cleanup
  if(objectUrl) URL.revokeObjectURL(objectUrl);

  const imgData = ctx.getImageData(0,0,w,h);
  const res = jsQR(imgData.data, w, h, { inversionAttempts:'attemptBoth' });
  return res ? res.data : null;
}

function applyImportedDeckCode(raw){
  try{
    // allow QR / pasted text to act as a hidden command
    if(__tryLaunch2PickFromCode(raw)) return;
    const code = normalizeDeckCodeFromText(raw);
    deckCodeBox.value = code;
    const obj = decodeDeck(code);
    buildMain = obj.main || {};
    buildMon  = obj.monster || {};
    renderDeckThumbs();
    updateBuildCount();
    alert('読込完了');
  }catch(e){
    alert('QRが不正です');
  }
}

// Buttons: generate / file
btnQrGen && (btnQrGen.onclick=()=>{
  const code=encodeDeck({main:buildMain,monster:buildMon});
  deckCodeBox.value=code;
  openQrModalWithCode(code);
});


btnQrFile && (btnQrFile.onclick=()=>{
  if(!qrFileInput){ alert('画像読込が利用できません'); return; }
  qrFileInput.value='';
  qrFileInput.click();
});

qrFileInput && (qrFileInput.onchange=async ()=>{
  const file = qrFileInput.files && qrFileInput.files[0];
  if(!file) return;
  const data = await decodeQrFromImageFile(file);
  if(!data){
    alert('画像からQRを読み取れませんでした（解像度/ピント/余白を確認）');
    return;
  }
  applyImportedDeckCode(data);
});
btnBuildCancel.onclick=()=>{closeBuilder();startModal.style.display='flex';};
btnBuildStart.onclick=()=>{if(!(sumObj(buildMain)===MAIN_LIMIT&&sumObj(buildMon)===MON_LIMIT)){alert('枚数が足りません');return;}closeBuilder();toolbar.classList.remove('hidden');setPlayModeUI(true);applyDeckAndStart({main:buildMain,monster:buildMon});autoLoadBackImage();};

// ===== Solo (一人回し) =====
let soloPickStep = 1; // 1: you(bottom) / 2: opp(top)
let soloDeckYou = null;
let soloDeckOpp = null;
let __soloWired = false;
let __soloActiveFrame = null;
let __soloForwardWired = false;
let __soloFrameBound = false;

function $solo(id){ return document.getElementById(id); }

function getActiveSoloFrame(){
  const fOpp = $solo('soloFrameOpp');
  const fYou = $solo('soloFrameYou');
  const sc = $solo('soloScroll');

  if(__soloActiveFrame && __soloActiveFrame.contentWindow) return __soloActiveFrame;

  // fallback: いま見えている側（スクロール位置）で推定
  try{
    const frameH = (typeof getSoloFrameViewportHeight === 'function') ? getSoloFrameViewportHeight() : window.innerHeight;
    if(sc && fOpp && fYou){
      return (sc.scrollTop < frameH * 0.5) ? fOpp : fYou;
    }
  }catch(e){}
  return fYou || fOpp || null;
}
// 親ツールバーの「コイントス」表示を、アクティブ盤面(iframe)の状態に追従させる
function mirrorMetaFromIframe(win){
  try{
    if(!win || !win.document) return;
    const pCoin = document.getElementById('btnCoin');
    const iCoin = win.document.getElementById('btnCoin');
    if(pCoin && iCoin) pCoin.textContent = iCoin.textContent;
  }catch(e){}
}

// ===== ソロ用メタ（コイン）を両盤面へ同期 =====
function soloPostMetaToFrame(fr){
  try{
    if(!fr || !fr.contentWindow) return;
    fr.contentWindow.postMessage({type:'SOLO_SET_META', coin:lastCoin}, '*');
  }catch(e){}
}
function soloBroadcastMeta(){
  try{
    const fOpp = $solo('soloFrameOpp');
    const fYou = $solo('soloFrameYou');
    soloPostMetaToFrame(fOpp);
    soloPostMetaToFrame(fYou);
  }catch(e){}
}
function soloCoinTossBroadcast(){
  if(IS_SPECTATOR) return;
  lastCoin = (Math.random()<0.5) ? '表' : '裏';
  updateCoinUI();
  try{ window.logAction && window.logAction(`コイントス：${lastCoin}`); }catch(e){}
  try{ if(typeof scheduleSpectatorSyncFast==='function') scheduleSpectatorSyncFast(); }catch(e){}
  soloBroadcastMeta();
}


function forwardToActiveIframe(targetId, payload){
  const fr = getActiveSoloFrame();
  if(!fr) return false;

  // 1) same-originなら直接叩く（hiddenボタンの click が効かない環境があるので onclick 優先）
  try{
    const win = fr.contentWindow;
    if(win && win.document){
      if(targetId === 'deckReturnPos'){
        const src = document.getElementById(targetId);
        const dst = win.document.getElementById(targetId);
        const v = (payload && typeof payload.value==='string') ? payload.value : (src ? src.value : '');
        if(dst){
          if(v) dst.value = v;
          dst.dispatchEvent(new Event('change', {bubbles:true}));
          return true;
        }
        return false;
      }

      const el = win.document.getElementById(targetId);
      if(!el) return false;

      if(typeof el.onclick === 'function'){ el.onclick(); return true; }
      if(typeof el.click === 'function'){ el.click(); return true; }
      return false;
    }
  }catch(e){
    // file:// や厳格設定などでクロスオリジン扱いになる場合があるので後段へ
  }

  // 2) クロスオリジンでも動く postMessage フォールバック
  try{
    if(fr.contentWindow){
      fr.contentWindow.postMessage({type:'SOLO_CMD', targetId, payload: payload||null}, '*');
      return true;
    }
  }catch(e){}
  return false;
}

// --- counter forwarding (solo root -> active iframe) ---
function forwardCounterOpen(){
  if(IS_EMBED) return false;
  if(!document.body.classList.contains('soloActive')) return false;
  const fr = getActiveSoloFrame();
  if(!fr) return false;
  try{
    const win = fr.contentWindow;
    if(win && typeof win.openCounterSelector==='function'){ win.openCounterSelector(); return true; }
  }catch(e){}
  try{
    if(fr.contentWindow){
      fr.contentWindow.postMessage({type:'SOLO_COUNTER_OPEN'}, '*');
      return true;
    }
  }catch(e){}
  return false;
}
function forwardCounterAdd(val){
  if(IS_EMBED) return false;
  if(!document.body.classList.contains('soloActive')) return false;
  const fr = getActiveSoloFrame();
  if(!fr) return false;
  const v = Number(val)||0;
  if(!v) return false;
  try{
    const win = fr.contentWindow;
    if(win && typeof win.applyCounterToSelection==='function'){ win.applyCounterToSelection(v); return true; }
  }catch(e){}
  try{
    if(fr.contentWindow){
      fr.contentWindow.postMessage({type:'SOLO_COUNTER_ADD', val:v}, '*');
      return true;
    }
  }catch(e){}
  return false;
}
function forwardCounterClear(){
  if(IS_EMBED) return false;
  if(!document.body.classList.contains('soloActive')) return false;
  const fr = getActiveSoloFrame();
  if(!fr) return false;
  try{
    const win = fr.contentWindow;
    if(win && typeof win.clearCounterOnSelection==='function'){ win.clearCounterOnSelection(); return true; }
  }catch(e){}
  try{
    if(fr.contentWindow){
      fr.contentWindow.postMessage({type:'SOLO_COUNTER_CLEAR'}, '*');
      return true;
    }
  }catch(e){}
  return false;
}


function wireSoloForwarding(){
  if(IS_EMBED) return;
  if(__soloForwardWired) return;
  __soloForwardWired = true;

  const tb = document.getElementById('toolbar');
  if(!tb) return;

  // ソロ中に「アクティブ盤面」に効かせたい操作
  const forwardIds = new Set([
    'btnFlip','btnRemove','btnToFront','btnToBack','btnUndo',
    'btnSave','btnLoad','btnTurnStart','btnPreview','btnToken',
    'btnCounter'
  ]);

  const getIdFromEvent = (ev)=>{
    const el = (ev.target && ev.target.closest) ? ev.target.closest('[id]') : null;
    return el ? el.id : '';
  };

  // クリックを、アクティブ盤面(iframe)に転送
  tb.addEventListener('click', (ev)=>{
    if(!document.body.classList.contains('soloActive')) return;

    const id = getIdFromEvent(ev);
    if(!id) return;

    // ファイル入力は親側で処理（ファイルダイアログを開く必要がある）
    if(id==='fileInput' || id==='backInput') return;

    // ソロ専用ボタンは親側で処理
    if(id==='btnSoloOverview' || id==='btnBackToMode') return;

    // 計算機/ショートカットは親側UIなので転送しない
    if(id==='btnCalc' || id==='btnShortcuts') return;

    // コイントスは「対戦全体の状態」なので親で決めて両方へ同期
    if(id==='btnCoin'){
      ev.preventDefault();
      ev.stopImmediatePropagation();
      soloCoinTossBroadcast();
      return;
    }

    // 共有用(手札非表示)：まず親でウィンドウを開いておく（ポップアップ対策）
    if(id==='btnOpenSpectator'){
      ev.preventDefault();
      ev.stopImmediatePropagation();
      try{
        // まずはユーザー操作の文脈で開く（既存があれば再利用）
        window.open(spectatorUrl(), 'GCardSpectator', 'popup,width=1280,height=720');
      }catch(e){}
      forwardToActiveIframe('btnOpenSpectator', {preopened:true});
      return;
    }

    if(!forwardIds.has(id)) return;

    ev.preventDefault();
    ev.stopImmediatePropagation();
    forwardToActiveIframe(id);
  }, true);

  // select も転送
  tb.addEventListener('change', (ev)=>{
    if(!document.body.classList.contains('soloActive')) return;

    const t = ev.target;
    if(!(t instanceof HTMLElement)) return;

    if(t.id === 'deckReturnPos'){
      ev.preventDefault();
      ev.stopImmediatePropagation();
      forwardToActiveIframe(t.id, {value: t.value});
    }
  }, true);

  // キーショートカットも転送（F / Del）
  document.addEventListener('keydown', (ev)=>{
    if(!document.body.classList.contains('soloActive')) return;

    const tag = (ev.target && ev.target.tagName) ? ev.target.tagName.toLowerCase() : '';
    if(tag==='input' || tag==='textarea') return;

    if(ev.key==='f' || ev.key==='F'){
      ev.preventDefault();
      ev.stopImmediatePropagation();
      forwardToActiveIframe('btnFlip');
    }else if(ev.key==='Delete'){
      ev.preventDefault();
      ev.stopImmediatePropagation();
      forwardToActiveIframe('btnRemove');
    }
  }, true);

  // 念のため：ソロ中は親側のonclickを無効化（誤って「カードを選択してください」が出るのを防ぐ）
  try{
    Array.from(forwardIds).forEach((id)=>{
      const btn = document.getElementById(id);
      if(!btn || btn.__soloGated) return;
      const orig = btn.onclick;
      btn.__soloGated = true;
      btn.__soloOrigOnclick = orig;
      btn.onclick = function(ev){
        if(document.body.classList.contains('soloActive')) return;
        if(typeof orig === 'function') return orig.call(this, ev);
      };
    });
  }catch(e){}
}

function bindSoloFrameFocus(){
  if(__soloFrameBound) return;

  const fOpp = $solo('soloFrameOpp');
  const fYou = $solo('soloFrameYou');
  if(!fOpp && !fYou) return;

  __soloFrameBound = true;

  const mark = (fr)=>{
    __soloActiveFrame = fr;
    try{ mirrorMetaFromIframe(fr && fr.contentWindow); }catch(e){}
  };

  [fOpp, fYou].forEach(fr=>{
    if(!fr) return;
    fr.addEventListener('focus', ()=>mark(fr));
    fr.addEventListener('pointerdown', ()=>mark(fr));
    fr.addEventListener('mouseenter', ()=>mark(fr));
  });
}


function soloDeckLabel(d){
  if(!d) return '(未選択)';
  return String(d.name||'(no name)');
}

function updateSoloDeckUI(){
  const soloStepText = $solo('soloStepText');
  const soloPickedInfo = $solo('soloPickedInfo');
  const btnSoloBack = $solo('btnSoloBack');
  const btnSoloStart = $solo('btnSoloStart');
  if(!soloStepText || !soloPickedInfo || !btnSoloBack || !btnSoloStart) return;

  if(soloPickStep===1){
    soloStepText.textContent = '1/2：下側（自分）のデッキを選択';
    btnSoloBack.disabled = true;
    btnSoloStart.disabled = true;
  }else{
    soloStepText.textContent = '2/2：上側（相手）のデッキを選択';
    btnSoloBack.disabled = false;
    btnSoloStart.disabled = !(!!soloDeckYou && !!soloDeckOpp);
  }
  soloPickedInfo.textContent = `自分：${soloDeckLabel(soloDeckYou)} / 相手：${soloDeckLabel(soloDeckOpp)}`;
}

function renderSoloDeckList(){
  const soloDeckList = $solo('soloDeckList');
  const soloDeckSearch = $solo('soloDeckSearch');
  if(!soloDeckList) return;

  const q = (soloDeckSearch && soloDeckSearch.value ? soloDeckSearch.value.trim().toLowerCase() : '');
  const decks = getDeckSaves().slice().sort((a,b)=>{
    const ta = Date.parse(a.updatedAt||a.createdAt||0) || 0;
    const tb = Date.parse(b.updatedAt||b.createdAt||0) || 0;
    return tb-ta;
  });
  const filtered = q ? decks.filter(d=>String(d.name||'').toLowerCase().includes(q)) : decks;

  // allow selecting current (unsaved) deck too
  const curEntry = { id:'__CURRENT__', name:'(いま構築中のデッキ)', deck: currentDeckObj(), createdAt:'', updatedAt:'' };

  soloDeckList.innerHTML = '';
  const list = [curEntry, ...filtered];

  list.forEach(d=>{
    const mCnt = sumObj(d.deck?.main||{});
    const kCnt = sumObj(d.deck?.monster||{});
    const div = document.createElement('div');
    div.className = 'soloDeckItem';
    div.innerHTML = `
      <div class="soloDeckMeta">
        <div class="soloDeckName">${escapeHtml(d.name||'(no name)')}</div>
        <div class="soloDeckInfo">メイン ${mCnt}/${MAIN_LIMIT} ・ 怪獣 ${kCnt}/${MON_LIMIT}</div>
      </div>
      <div class="soloDeckActions">
        <button type="button" class="primary" data-id="${escapeHtml(d.id)}">選ぶ</button>
      </div>
    `;
    soloDeckList.appendChild(div);
  });
}

function ensureSoloWired(){
  if(__soloWired) return;

  const soloDeckModal = $solo('soloDeckModal');
  if(!soloDeckModal) return; // DOMまだ

  const btnSoloClose = $solo('btnSoloClose');
  const btnSoloBack  = $solo('btnSoloBack');
  const btnSoloStart = $solo('btnSoloStart');
  const btnSoloExit  = $solo('btnSoloExit');
const btnSoloOverview = document.getElementById('btnSoloOverview');
  const soloDeckSearch = $solo('soloDeckSearch');
  const soloDeckList = $solo('soloDeckList');

  btnSoloClose && (btnSoloClose.onclick = ()=>closeSoloDeckModal());
  soloDeckModal.addEventListener('mousedown',(e)=>{ if(e.target===soloDeckModal) closeSoloDeckModal(); });

  soloDeckSearch && soloDeckSearch.addEventListener('input', renderSoloDeckList);

  soloDeckList && soloDeckList.addEventListener('click',(e)=>{
    const btn = e.target.closest('button[data-id]');
    if(!btn) return;
    pickSoloDeckById(btn.dataset.id);
  });

  btnSoloBack && (btnSoloBack.onclick = ()=>{
    if(soloPickStep===2){
      soloPickStep=1;
      soloDeckOpp=null;
      updateSoloDeckUI();
      renderSoloDeckList();
    }
  });

  btnSoloStart && (btnSoloStart.onclick = ()=>startSoloMode());
  btnSoloExit && (btnSoloExit.onclick = ()=>exitSoloMode());
btnSoloOverview && (btnSoloOverview.onclick = ()=>toggleSoloOverview());

  try{ wireSoloForwarding(); }catch(e){}
  try{ bindSoloFrameFocus(); }catch(e){}

  __soloWired = true;
}

function openSoloDeckModal(){
  // クリック時にはDOMができてる想定。念のため配線。
  ensureSoloWired();

  const soloDeckModal = $solo('soloDeckModal');
  const soloDeckSearch = $solo('soloDeckSearch');
  if(!soloDeckModal) return;

  soloPickStep = 1;
  soloDeckYou = null;
  soloDeckOpp = null;

  if(soloDeckSearch) soloDeckSearch.value='';
  soloDeckModal.classList.remove('hidden');
  updateSoloDeckUI();
  renderSoloDeckList();

  setTimeout(()=>{ try{ soloDeckSearch && soloDeckSearch.focus(); }catch(e){} }, 0);
}

function closeSoloDeckModal(){
  const soloDeckModal = $solo('soloDeckModal');
  if(!soloDeckModal) return;
  soloDeckModal.classList.add('hidden');
}

function pickSoloDeckById(id){
  const decks = getDeckSaves();
  let d = null;

  if(String(id)==='__CURRENT__'){
    d = { id:'__CURRENT__', name:'(いま構築中のデッキ)', deck: currentDeckObj() };
  }else{
    d = decks.find(x=>String(x.id)===String(id));
  }
  if(!d || !d.deck){ alert('デッキが見つかりません'); renderSoloDeckList(); return; }

  if(soloPickStep===1){
    soloDeckYou = {name:d.name, deck: cloneDeckObj(d.deck)};
    soloPickStep = 2;
  }else{
    soloDeckOpp = {name:d.name, deck: cloneDeckObj(d.deck)};
  }
  updateSoloDeckUI();
}


function updateSoloToolbarHeightVar(){
  try{
    const tb = document.getElementById('toolbar');
    const h = tb ? (tb.getBoundingClientRect().height + 16) : 0;
    document.documentElement.style.setProperty('--soloToolbarH', String(Math.ceil(h)) + 'px');
    return h;
  }catch(e){
    return 0;
  }
}

function getSoloFrameViewportHeight(){
  const tbH = updateSoloToolbarHeightVar();
  return Math.max(220, window.innerHeight - tbH);
}

function applySoloOverviewScale(){
  const soloContainer = $solo('soloContainer');
  if(!soloContainer || !soloContainer.classList.contains('overview')) return;

  const soloScroll = $solo('soloScroll');
  if(!soloScroll) return;

  const tbH = updateSoloToolbarHeightVar();
  const pad = 24; // overview padding
  const availW = Math.max(240, window.innerWidth - pad);
  const availH = Math.max(240, window.innerHeight - tbH - pad);

  const frameH = Math.max(220, window.innerHeight - tbH);
  const contentW = window.innerWidth;
  const contentH = frameH * 2;

  const scale = Math.max(0.2, Math.min(0.8, Math.min(availW / contentW, availH / contentH)));

  soloContainer.style.setProperty('--soloOverviewScale', String(scale));

  // 先頭(相手盤面側)から2面見えるように
  try{ soloScroll.scrollTop = 0; }catch(e){}
}

function toggleSoloOverview(force){
  const soloContainer = $solo('soloContainer');
  if(!soloContainer || soloContainer.classList.contains('hidden')) return;

  const on = (typeof force==='boolean') ? force : !soloContainer.classList.contains('overview');
  soloContainer.classList.toggle('overview', on);

  // ボタン表示
  const b = document.getElementById('btnSoloOverview');
  if(b) b.textContent = on ? '🧩 通常表示' : '🧩 2面表示';

  if(on) applySoloOverviewScale();
}

window.addEventListener('resize', ()=>{ try{ if(document.body.classList.contains('soloActive')) updateSoloToolbarHeightVar(); }catch(e){}; applySoloOverviewScale(); });

function startSoloMode(){
  if(!(soloDeckYou && soloDeckOpp)){ alert('デッキを2つ選択してください'); return; }
  closeSoloDeckModal();

  // hide main UI and open solo container
  try{ builder.classList.add('hidden'); }catch(e){}
  try{ toolbar.classList.remove('hidden'); }catch(e){}
  setPlayModeUI(true);
  try{ document.body.classList.add('soloActive'); }catch(e){}
  // ソロ開始時はメタ（コイン）を初期化して親・両盤面で揃える
  try{ lastCoin=null; updateCoinUI(); }catch(e){}
  try{ updateSoloToolbarHeightVar(); }catch(e){}
  try{ viewer.classList.add('hidden'); }catch(e){}
  try{ preview.classList.add('hidden'); }catch(e){}
  try{ startModal.style.display='none'; }catch(e){}

  const soloContainer = $solo('soloContainer');
  const soloScroll = $solo('soloScroll');
  const soloFrameOpp = $solo('soloFrameOpp');
  const soloFrameYou = $solo('soloFrameYou');

  if(soloContainer) soloContainer.classList.remove('hidden');
  try{ if(soloContainer) soloContainer.classList.remove('overview'); }catch(e){}
  try{ const b=document.getElementById('btnSoloOverview'); if(b) b.textContent='🧩 2面表示'; }catch(e){}

  const baseUrl = location.href.split('#')[0].split('?')[0];
  const deckOpp = soloDeckOpp.deck;
  const deckYou = soloDeckYou.deck;

  // send deck when each iframe is ready (set onload BEFORE src)
  if(soloFrameOpp){
    soloFrameOpp.onload = ()=>{
      try{ soloFrameOpp.contentWindow.postMessage({type:'SOLO_INIT_DECK', deck: deckOpp}, '*'); }catch(e){}
      // ソロのメタ（コイン）も初期同期
      try{ soloFrameOpp.contentWindow.postMessage({type:'SOLO_SET_META', coin:lastCoin}, '*'); }catch(e){}
    };
    soloFrameOpp.src = baseUrl + '?embed=1&flip=1';
  }
  if(soloFrameYou){
    soloFrameYou.onload = ()=>{
      try{ soloFrameYou.contentWindow.postMessage({type:'SOLO_INIT_DECK', deck: deckYou}, '*'); }catch(e){}
      // ソロのメタ（コイン）も初期同期
      try{ soloFrameYou.contentWindow.postMessage({type:'SOLO_SET_META', coin:lastCoin}, '*'); }catch(e){}
    };
    soloFrameYou.src = baseUrl + '?embed=1';
  }

  try{ wireSoloForwarding(); }catch(e){}
  try{ bindSoloFrameFocus(); }catch(e){}
  try{ __soloActiveFrame = soloFrameYou || soloFrameOpp; }catch(e){}

  // start at "you" board (bottom)
  setTimeout(()=>{
    try{ if(soloScroll) soloScroll.scrollTop = getSoloFrameViewportHeight(); }catch(e){}
  }, 80);
}

function exitSoloMode(destination='builder'){
  // destination: 'builder' or 'start'
  const soloContainer = $solo('soloContainer');
  const soloFrameOpp = $solo('soloFrameOpp');
  const soloFrameYou = $solo('soloFrameYou');

  if(!soloContainer) return;
  soloContainer.classList.add('hidden');
  try{ document.body.classList.remove('soloActive'); }catch(e){}
  try{ __soloActiveFrame = null; }catch(e){}
  try{ const sc=$solo('soloContainer'); if(sc) sc.classList.remove('overview'); }catch(e){}

  // cleanup iframes
  try{ if(soloFrameOpp) soloFrameOpp.src = 'about:blank'; }catch(e){}
  try{ if(soloFrameYou) soloFrameYou.src = 'about:blank'; }catch(e){}

  // where to go after solo
  try{
    if(destination==='start'){ goBackToMode(); }
    else { openBuilder(); }
  }catch(e){}
}

// wiring (btnBuildSoloは元DOMにあるので即OK)
btnBuildSolo && (btnBuildSolo.onclick = ()=>{ openSoloDeckModal(); });

// DOM末尾にsolo UIがあるので、ロード後に念のため配線
window.addEventListener('DOMContentLoaded', ensureSoloWired);

function encodeDeck(obj){
  // v2: compact (index+count), much shorter than v1(JSON->base64)
  try{
    const main = obj?.main || {};
    const monster = obj?.monster || {};
    const encMap = (mp)=>{
      const pairs=[];
      for(const [id,c] of Object.entries(mp)){
        const n = Number(c)||0;
        if(n<=0) continue;
        const idx = IDS.indexOf(id);
        if(idx<0) continue;
        pairs.push([idx, n]);
      }
      pairs.sort((a,b)=>a[0]-b[0]);
      return pairs.map(([i,n])=> i.toString(36)+'.'+n.toString(36)).join(',');
    };
    return 'v2:'+encMap(main)+'|'+encMap(monster);
  }catch(e){
    // fallback: legacy v1
    return 'v1:'+btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  }
}
function decodeDeck(code){
  if(!code) throw new Error('empty');
  if(code.startsWith('v2:')){
    const body = code.slice(3);
    const [mStr='', monStr=''] = body.split('|');
    const decMap = (s)=>{
      const mp={};
      if(!s) return mp;
      const parts = s.split(',');
      for(const p of parts){
        if(!p) continue;
        const [i36,c36] = p.split('.');
        const idx = parseInt(i36,36);
        const n = parseInt(c36,36);
        const id = IDS[idx];
        if(!id || !isFinite(n) || n<=0) continue;
        mp[id]=n;
      }
      return mp;
    };
    return { main: decMap(mStr), monster: decMap(monStr) };
  }
  if(code.startsWith('v1:')){
    const json = decodeURIComponent(escape(atob(code.slice(3))));
    return JSON.parse(json);
  }
  throw new Error('ver');
}
function applyDeckAndStart(obj){ // ←ここで怪獣デッキ順を反転
  Object.values(state.cards).forEach(c=>{const el=document.getElementById(c.id);if(el)el.remove();});
  state.cards={};state.order=[];deckPool=[];discardPool=[];monsterPool=[];selection.clear();Object.keys(dupCountByName).forEach(k=>delete dupCountByName[k]);idCounter=0;rageCount=0;updateRageDisplay();
  // メインは通常順
  Object.entries(obj.main).forEach(([id,count])=>{
    const info=CARD_DB.find(c=>c.id===id)||{name:id,srcGuess:WHITE_BACK};
    for(let i=0;i<count;i++){
      const c=spawnCard(info.srcGuess,{zone:'deckMain',faceDown:true,origName:info.name,metaId:id});
      deckPool.push(c.id);hideIfPooled(c);
    }
  });
  // 怪獣は反転して追加（左側＝最初の要素が最後に生成→最前面）
  Object.entries(obj.monster).reverse().forEach(([id,count])=>{
    const info=CARD_DB.find(c=>c.id===id)||{name:id,srcGuess:WHITE_BACK};
    for(let i=0;i<count;i++){
      const c=spawnCard(info.srcGuess,{zone:'monster',faceDown:true,origName:info.name,metaId:id});
      monsterPool.push(c.id);hideIfPooled(c);
    }
  });
  shuffleDeck();updateCounters();pushUndo();
}

// smoke
(function(){try{console.assert(typeof bringToBack==='function');console.assert(typeof encodeDeck==='function');console.log('%cSmoke OK','color:#0f0');}catch(e){console.error(e);}})();

pushUndo();updateCounters();updateRageDisplay();
initPlayHud();

// [spectator-sync] 状態読み込み後も同期
let __wrapLoadFromJSON=false;try{if(!__wrapLoadFromJSON){const __loadFromJSON=loadFromJSON;loadFromJSON=(json,push=true)=>{__loadFromJSON(json,push);sendStateToSpectator();};__wrapLoadFromJSON=true;}}catch(e){}

// [spectator-sync] Undo積み後も同期
let __wrapPushUndo=false;try{if(!__wrapPushUndo){const __pushUndo=pushUndo;pushUndo=()=>{__pushUndo();sendStateToSpectator();};__wrapPushUndo=true;}}catch(e){}


/* ===== Added: Calculator (Play mode) & Shortcuts list ===== */
(function(){
  // -------- Shortcuts modal --------
  const btnShortcuts = document.getElementById('btnShortcuts');
  const shortcuts = document.getElementById('shortcuts');
  const btnShortcutsClose = document.getElementById('btnShortcutsClose');

  function openShortcuts(){
    if(!shortcuts) return;
    shortcuts.classList.remove('hidden');
    try{ shortcuts.tabIndex = -1; shortcuts.focus(); }catch(e){}
  }
  function closeShortcuts(){
    if(!shortcuts) return;
    shortcuts.classList.add('hidden');
  }

  if(btnShortcuts) btnShortcuts.onclick = openShortcuts;
  if(btnShortcutsClose) btnShortcutsClose.onclick = closeShortcuts;
  if(shortcuts){
    shortcuts.addEventListener('click', (e)=>{ if(e.target===shortcuts) closeShortcuts(); });
  }

  // キャプチャで握って、ショートカット表示中に盤面操作が誤爆しないようにする
  document.addEventListener('keydown', (e)=>{
    if(!shortcuts || shortcuts.classList.contains('hidden')) return;

    if(e.key === 'Escape'){
      e.preventDefault();
      e.stopImmediatePropagation();
      closeShortcuts();
      return;
    }

    // 代表的な盤面ショートカットは抑制
    const isSpace = (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar');
    if(e.key === 'Delete' || e.key === 'f' || e.key === 'F' || e.key === 'e' || e.key === 'E' || e.key === 'r' || e.key === 'R' || isSpace){
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  // -------- Calculator widget --------
  const btnCalc = document.getElementById('btnCalc');
  const w = document.getElementById('calcWidget');
  if(!w) return;

  const header = document.getElementById('calcHeader');
  const input = document.getElementById('calcInput');
  const resultVal = document.querySelector('#calcResult .val');
  const errEl = document.getElementById('calcErr');
  const histEl = document.getElementById('calcHistory');

  const btnEval = document.getElementById('btnCalcEval');
  const btnCopy = document.getElementById('btnCalcCopy');
  const btnBack = document.getElementById('btnCalcBack');
  const btnClose = document.getElementById('btnCalcClose');
  const btnClear = document.getElementById('btnCalcClear');

  const POS_KEY = 'gcd_calc_pos_v1';
  const HIST_KEY = 'gcd_calc_hist_v1';

  let lastValue = '0';

  function showErr(msg){
    if(!errEl) return;
    if(msg){
      errEl.textContent = String(msg);
      errEl.classList.remove('hidden');
    }else{
      errEl.textContent = '';
      errEl.classList.add('hidden');
    }
  }
  function setResult(v){
    lastValue = String(v);
    if(resultVal) resultVal.textContent = lastValue;
  }

  function normalizeExpr(s){
    return String(s||'')
      .replace(/[×]/g,'*')
      .replace(/[÷]/g,'/')
      .replace(/,/g,'')
      .replace(/\^/g,'**');
  }

  function fmtNumber(v){
    // できるだけ見やすく（小数は末尾0を落とす）
    if(typeof v !== 'number') return String(v);
    if(!isFinite(v)) return String(v);
    let s = String(v);
    if(s.includes('e') || s.includes('E')) return s;
    if(s.includes('.')){
      s = s.replace(/(\.\d*?[1-9])0+$/,'$1').replace(/\.0+$/,'');
    }
    return s;
  }

  function safeEval(expr){
    const s = normalizeExpr(expr).trim();
    if(!s) return { err: '式を入力してね' };

    // 数字と演算子だけ許可（Function の注入対策）
    if(!/^[0-9+\-*/().%\s]*$/.test(s)){
      return { err: '使えるのは 数字 と + - * / % ( ) . だけです' };
    }

    try{
      const v = Function('"use strict";return (' + s + ')')();
      if(typeof v !== 'number' || !isFinite(v)) return { err: '計算結果が不正です（∞/NaN）' };
      return { val: v };
    }catch(e){
      return { err: '式が正しくないっぽい（括弧や演算子を確認）' };
    }
  }

  function loadHistory(){
    try{
      const a = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
      return Array.isArray(a) ? a : [];
    }catch(e){
      return [];
    }
  }
  function saveHistory(a){
    try{
      localStorage.setItem(HIST_KEY, JSON.stringify(a.slice(0, 30)));
    }catch(e){}
  }
  function renderHistory(){
    if(!histEl) return;
    const hist = loadHistory();
    histEl.innerHTML = '';
    if(!hist.length){
      const d = document.createElement('div');
      d.className = 'calcHistItem';
      d.style.opacity = '.65';
      d.textContent = '（履歴なし）';
      d.onclick = ()=>{ try{ input?.focus(); }catch(e){} };
      histEl.appendChild(d);
      return;
    }
    hist.forEach(it=>{
      const d = document.createElement('div');
      d.className = 'calcHistItem';
      d.textContent = `${it.expr} = ${it.res}`;
      d.title = 'クリックで式を入力';
      d.onclick = ()=>{
        if(!input) return;
        input.value = it.expr;
        input.focus();
        try{ input.select(); }catch(e){}
      };
      histEl.appendChild(d);
    });
  }
  function addHistory(expr, res){
    const item = { expr: String(expr).trim(), res: String(res) };
    const hist = loadHistory().filter(h => !(h.expr === item.expr && h.res === item.res));
    hist.unshift(item);
    saveHistory(hist);
    renderHistory();
  }

  function evaluate(){
    const expr = input ? input.value : '';
    const out = safeEval(expr);
    if(out.err){
      showErr(out.err);
      return;
    }
    showErr('');
    const res = fmtNumber(out.val);
    setResult(res);
    addHistory(expr, res);
  }

  function restorePos(){
    try{
      const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if(p && typeof p.x === 'number' && typeof p.y === 'number'){
        w.style.left = p.x + 'px';
        w.style.top  = p.y + 'px';
        w.style.right = 'auto';
      }
    }catch(e){}
  }
  function savePos(){
    try{
      const r = w.getBoundingClientRect();
      localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) }));
    }catch(e){}
  }

  function openCalc(){
    w.classList.remove('hidden');
    showErr('');
    restorePos();
    renderHistory();
    try{ input?.focus(); input?.select(); }catch(e){}
  }
  function closeCalc(){
    w.classList.add('hidden');
    showErr('');
  }
  function toggleCalc(){
    if(w.classList.contains('hidden')) openCalc();
    else closeCalc();
  }

  if(btnCalc) btnCalc.onclick = toggleCalc;
  if(btnClose) btnClose.onclick = closeCalc;
  if(btnClear) btnClear.onclick = ()=>{
    if(input) input.value = '';
    showErr('');
    setResult('0');
    try{ input?.focus(); }catch(e){}
  };
  if(btnEval) btnEval.onclick = evaluate;

  if(btnBack) btnBack.onclick = ()=>{
    if(!input) return;
    input.focus();
    const s = input.selectionStart ?? 0;
    const e = input.selectionEnd ?? 0;
    const v = input.value || '';
    if(s !== e){
      input.value = v.slice(0, s) + v.slice(e);
      input.setSelectionRange(s, s);
    }else if(s > 0){
      input.value = v.slice(0, s-1) + v.slice(s);
      input.setSelectionRange(s-1, s-1);
    }
  };

  if(btnCopy) btnCopy.onclick = async ()=>{
    const text = String(lastValue || '');
    if(!text){ alert('結果がありません'); return; }
    try{
      await navigator.clipboard.writeText(text);
    }catch(err){
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    try{
      const orig = btnCopy.textContent;
      btnCopy.textContent = 'コピー済み';
      setTimeout(()=>{ btnCopy.textContent = orig; }, 650);
    }catch(e){}
  };

  if(input){
    input.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter'){
        e.preventDefault();
        evaluate();
      }else if(e.key === 'Escape'){
        e.preventDefault();
        closeCalc();
      }
    });
  }

  // drag move (header)
  let drag = null;
  if(header){
    header.addEventListener('pointerdown', (e)=>{
      const t = e.target;
      if(t && t.closest && t.closest('button')) return;

      if(w.classList.contains('hidden')) return;
      e.preventDefault();

      const r = w.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };

      try{ header.setPointerCapture(e.pointerId); }catch(err){}

      const onMove = (ev)=>{
        if(!drag) return;
        const x = Math.max(6, Math.min(window.innerWidth  - r.width  - 6, ev.clientX - drag.dx));
        const y = Math.max(6, Math.min(window.innerHeight - r.height - 6, ev.clientY - drag.dy));
        w.style.left = x + 'px';
        w.style.top  = y + 'px';
        w.style.right = 'auto';
      };

      const onUp = ()=>{
        if(!drag) return;
        drag = null;
        document.removeEventListener('pointermove', onMove, true);
        savePos();
      };

      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, { once:true, capture:true });
      document.addEventListener('pointercancel', onUp, { once:true, capture:true });
    });
  }
})();


/* ======================================================
 * 🕹️ Hidden Mini Game: ゴジカ 2Pick（Draft）
 *  - Trigger: 画面上で "g2pick"（or "2pick"）とタイプ
 *  - 怪獣：等級 I/II/III/IV を各1枚（各回2択）
 *  - メイン：25回ドラフト（各回「2枚セット」の2択）= 合計50枚
 *  - 2進攻(advance=2) は 10回のプレミア回でのみ提示（=最大10枚）
 *  - 同名上限4枚（MAX_DUP_PER_NAME）
 *  - card_meta.js に登録がないカード（metaなし）は提示しない
 * ====================================================== */
(function(){
  if(typeof IS_SPECTATOR!=='undefined' && IS_SPECTATOR) return;

  // ---------- utilities ----------
  const __dEsc = (s)=>String(s??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const __sum = (o)=>Object.values(o||{}).reduce((a,b)=>a+(Number(b)||0),0);
  const __randInt = (n)=>Math.floor(Math.random()*n);
  const __pick = (arr)=>arr && arr.length ? arr[__randInt(arr.length)] : null;

  function __hasMeta(id){
    try{ return !!(typeof getMetaById==='function' && getMetaById(id)); }catch(e){ return false; }
  }
  function __metaOf(id){
    try{ return (typeof getMetaById==='function' ? getMetaById(id) : null); }catch(e){ return null; }
  }
  function __isTokenMeta(m){
    if(!m) return false;
    const t = String(m.type||'');
    if(t.includes('トークン')) return true;
    const feats = Array.isArray(m.features) ? m.features : [];
    const raw = String(m.features_raw||'');
    return feats.includes('トークン') || raw.includes('トークン');
  }
  function __cardObjById(id){
    try{ return CARD_DB.find(c=>c.id===id) || {id, srcGuess: (typeof CARD_FOLDER!=='undefined' ? `${CARD_FOLDER}/${id}.png` : ''), name:id}; }
    catch(e){ return {id, srcGuess:'', name:id}; }
  }

  // ---------- modal / UI ----------
  let __modal=null, __panel=null;
  let __sub=null, __msg=null;
  let __optA=null, __optB=null;
  let __btnPick=null, __btnReroll=null, __btnExit=null, __btnApply=null, __btnCopy=null;

  function __ensureModal(){
    if(__modal) return;

    // style (inject once)
    if(!document.getElementById('draft2pickStyle')){
      const st=document.createElement('style');
      st.id='draft2pickStyle';
      st.textContent = `
#draft2pick.hidden{display:none !important;}
#draft2pick{position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.86);display:flex;align-items:center;justify-content:center;padding:18px;}
#draft2pickPanel{width:min(1040px,96vw);max-height:92vh;background:rgba(28,28,28,.96);border:1px solid rgba(255,255,255,.14);border-radius:22px;box-shadow:0 16px 60px rgba(0,0,0,.55);display:flex;flex-direction:column;overflow:hidden;}
#draft2pickPanel .dHdr{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.12);}
#draft2pickPanel .dTitle{font-weight:900;font-size:18px;letter-spacing:.2px;}
#draft2pickPanel .dSub{opacity:.85;font-size:12px;line-height:1.2;white-space:pre-line;margin-left:auto;text-align:right;}
#draft2pickPanel .dClose{all:unset;cursor:pointer;font-size:18px;padding:6px 10px;border-radius:10px;opacity:.9;}
#draft2pickPanel .dClose:hover{background:rgba(255,255,255,.08);}
#draft2pickPanel .dBody{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px 14px;overflow:auto;}
#draft2pickPanel .dOpt{border:1px solid rgba(255,255,255,.14);border-radius:18px;background:rgba(255,255,255,.05);padding:10px;cursor:pointer;min-height:280px;display:flex;flex-direction:column;gap:10px;outline:none;}
#draft2pickPanel .dOpt:hover{background:rgba(255,255,255,.08);}
#draft2pickPanel .dOpt.selected{outline:3px solid rgba(255,214,10,.85);}
#draft2pickPanel .dOptHdr{display:flex;align-items:center;justify-content:space-between;gap:10px;}
#draft2pickPanel .dOptTag{font-weight:900;opacity:.95;}
#draft2pickPanel .dOptHint{opacity:.7;font-size:12px;}
#draft2pickPanel .dCards{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start;}
#draft2pickPanel .dCard{flex:1 1 220px;min-width:220px;max-width:calc(50% - 6px);display:flex;gap:10px;align-items:flex-start;}
#draft2pickPanel .dCard img{width:86px;height:auto;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.25);cursor:zoom-in;}
#draft2pickPanel .dCard .dTxt{display:flex;flex-direction:column;gap:4px;min-width:0;}
#draft2pickPanel .dCard .dName{font-weight:900;line-height:1.2;font-size:14px;word-break:break-word;}
#draft2pickPanel .dCard .dMeta{opacity:.75;font-size:12px;line-height:1.2;}
#draft2pickPanel .dFooter{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border-top:1px solid rgba(255,255,255,.12);}
#draft2pickPanel .dMsg{opacity:.9;font-size:12px;white-space:pre-line;}
#draft2pickPanel .dBtns{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;}
#draft2pickPanel button{cursor:pointer;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;padding:8px 12px;border-radius:12px;font-weight:800;}
#draft2pickPanel button:hover{background:rgba(255,255,255,.10);}
#draft2pickPanel button.primary{background:rgba(255,214,10,.15);border-color:rgba(255,214,10,.35);}
#draft2pickPanel button:disabled{opacity:.45;cursor:not-allowed;}
      `;
      document.head.appendChild(st);
    }

    __modal=document.createElement('div');
    __modal.id='draft2pick';
    __modal.className='hidden';
    __modal.innerHTML=`
      <div id="draft2pickPanel" role="dialog" aria-modal="true" aria-label="ゴジカ 2Pick">
        <div class="dHdr">
          <div class="dTitle">🕹️ ゴジカ 2Pick（隠しミニゲーム）</div>
          <div class="dSub" id="draft2pickSub"></div>
          <button class="dClose" id="draft2pickClose" type="button" aria-label="閉じる">✕</button>
        </div>
        <div class="dBody">
          <div class="dOpt" id="draft2pickA" tabindex="0" role="button" aria-label="Aを選ぶ"></div>
          <div class="dOpt" id="draft2pickB" tabindex="0" role="button" aria-label="Bを選ぶ"></div>
        </div>
        <div class="dFooter">
          <div class="dMsg" id="draft2pickMsg"></div>
          <div class="dBtns">
            <button id="draft2pickReroll" type="button">リロール</button>
            <button id="draft2pickPick" type="button" class="primary">選択して進む</button>
            <button id="draft2pickCopy" type="button">デッキコードコピー</button>
            <button id="draft2pickApply" type="button">構築画面へ反映</button>
            <button id="draft2pickExit" type="button">終了</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(__modal);

    __panel=document.getElementById('draft2pickPanel');
    __sub=document.getElementById('draft2pickSub');
    __msg=document.getElementById('draft2pickMsg');
    __optA=document.getElementById('draft2pickA');
    __optB=document.getElementById('draft2pickB');
    __btnPick=document.getElementById('draft2pickPick');
    __btnReroll=document.getElementById('draft2pickReroll');
    __btnExit=document.getElementById('draft2pickExit');
    __btnApply=document.getElementById('draft2pickApply');
    __btnCopy=document.getElementById('draft2pickCopy');

    const btnClose=document.getElementById('draft2pickClose');
    btnClose.onclick=()=>__closeDraft();

    // click outside to close
    __modal.addEventListener('pointerdown',(e)=>{
      if(e.target===__modal) __closeDraft();
    });

    // keyboard inside modal
    __panel.addEventListener('keydown',(e)=>{
      if(e.key==='Escape'){
        const pv=document.getElementById('preview');
        if(pv && !pv.classList.contains('hidden')) return;
        e.preventDefault(); __closeDraft(); return;
      }
      if(e.key==='1' || e.key==='a' || e.key==='A'){ e.preventDefault(); __selectOpt('A'); return; }
      if(e.key==='2' || e.key==='b' || e.key==='B'){ e.preventDefault(); __selectOpt('B'); return; }
      if(e.key==='Enter'){ e.preventDefault(); __confirmPick(); return; }
      if(e.key==='r' || e.key==='R'){ e.preventDefault(); __doReroll(); return; }
    });

    __optA.addEventListener('click',()=>__selectOpt('A'));
    __optB.addEventListener('click',()=>__selectOpt('B'));
    __btnPick.addEventListener('click',()=>__confirmPick());
    __btnReroll.addEventListener('click',()=>__doReroll());
    __btnExit.addEventListener('click',()=>__closeDraft());
    __btnApply.addEventListener('click',()=>__applyToBuilder());
    __btnCopy.addEventListener('click',()=>__copyDeckCode());
  }

  // ---------- pools (metaありのみ) ----------
  let __poolsBuilt=false;
  let __monByGrade={1:[],2:[],3:[],4:[]};
  let __mainNormal=[], __mainAdv2=[];
  function __buildPools(){
    if(__poolsBuilt) return;
    __poolsBuilt=true;

    try{
      (CARD_DB||[]).forEach(c=>{
        const m = c.meta || __metaOf(c.id);
        if(!m) return; // ここが重要：metaがないカードは一切提示しない
        if(__isTokenMeta(m)) return;

        if(String(m.type||'')==='怪獣'){
          const g=Number(m.grade||0);
          if(__monByGrade[g]) __monByGrade[g].push(c);

          // ★メインデッキ候補にも怪獣を含める（この2Pickモードは色/特徴縛りなし）
          const adv=Number(m.advance||0);
          if(adv===2) __mainAdv2.push(c);
          else __mainNormal.push(c);
        }else{
          const adv=Number(m.advance||0);
          if(adv===2) __mainAdv2.push(c);
          else __mainNormal.push(c);
        }
      });
    }catch(e){}
  }

  // ---------- draft session ----------
  const CFG = {
    mainRounds: 25,
    premiumRounds: 10,
    rerollMonster: 1,
    rerollMain: 2,
    maxDup: (typeof MAX_DUP_PER_NAME!=='undefined' ? MAX_DUP_PER_NAME : 4),
  };

  let __ds=null;     // session
  let __offer=null;  // {A:[ids], B:[ids]}
  let __selected=null;

  function __newSession(){
    __buildPools();

    // プレミア回（=2進攻枠）をランダムで10回
    const prem = new Set();
    while(prem.size < Math.min(CFG.premiumRounds, CFG.mainRounds)){
      prem.add(__randInt(CFG.mainRounds));
    }

    __ds = {
      phase: 'monster',   // monster -> main -> done
      grade: 1,
      round: 0,
      premiumIdx: prem,
      rerollM: CFG.rerollMonster,
      rerollMain: CFG.rerollMain,
      main: {},
      monster: {},
    };
    __offer = null;
    __selected = null;
  }

  function __countOf(map,id){ return Number(map && map[id])||0; }
  function __canTake(map,id){ return __countOf(map,id) < CFG.maxDup; }

  function __pickOne(list, map, excludeSet){
    if(!Array.isArray(list) || !list.length) return null;
    const ex = excludeSet || new Set();
    // try random a bit
    for(let t=0;t<250;t++){
      const c = __pick(list);
      if(!c) break;
      const id=c.id;
      if(ex.has(id)) continue;
      if(!__canTake(map,id)) continue;
      return c;
    }
    // fallback linear
    for(const c of list){
      if(!c) continue;
      const id=c.id;
      if(ex.has(id)) continue;
      if(!__canTake(map,id)) continue;
      return c;
    }
    return null;
  }

  function __pickDistinct(list, map, n, excludeIds){
    const ex = excludeIds || new Set();
    const out=[];
    const used=new Set(ex);
    for(let i=0;i<n;i++){
      const c = __pickOne(list, map, used);
      if(!c) break;
      out.push(c);
      used.add(c.id);
    }
    return out;
  }

  function __pairNormal(map){
    const a = __pickDistinct(__mainNormal, map, 2, new Set());
    if(a.length===2) return a.map(x=>x.id);
    // fallback: allow 1 card option (shouldn't happen)
    return a.map(x=>x.id);
  }

  function __pairPremium(map){
    const ex = new Set();
    const adv = __pickOne(__mainAdv2, map, ex);
    if(adv) ex.add(adv.id);
    const nor = __pickOne(__mainNormal, map, ex);
    const ids = [];
    if(adv) ids.push(adv.id);
    if(nor) ids.push(nor.id);
    // fallback: if missing normal, fill from normal pool ignoring distinct within pair
    if(ids.length<2){
      const fill = __pickOne(__mainNormal, map, new Set(ids));
      if(fill) ids.push(fill.id);
    }
    return ids;
  }

  function __makeOffer(){
    if(!__ds) return;
    __selected=null;

    let offerA=[], offerB=[];
    let hintA='A', hintB='B';

    if(__ds.phase==='monster'){
      const g = __ds.grade;
      const list = __monByGrade[g] || [];
      const ca = __pickOne(list, __ds.monster, new Set());
      const cb = __pickOne(list, __ds.monster, new Set(ca? [ca.id] : []));
      if(!ca || !cb){
        // metaが薄い場合の最終フォールバック
        offerA = ca ? [ca.id] : [];
        offerB = cb ? [cb.id] : [];
      }else{
        offerA=[ca.id]; offerB=[cb.id];
      }
      hintA=`等級${g}：A`;
      hintB=`等級${g}：B`;
    }else if(__ds.phase==='main'){
      const isPrem = __ds.premiumIdx.has(__ds.round);
      if(isPrem){
        offerA = __pairPremium(__ds.main);
        offerB = __pairPremium(__ds.main);
        // まったく同じになったら少しだけ引き直し
        let guard=0;
        while(guard++<30 && offerA.join('|')===offerB.join('|')){
          offerB = __pairPremium(__ds.main);
        }
        hintA='プレミア枠：A';
        hintB='プレミア枠：B';
      }else{
        offerA = __pairNormal(__ds.main);
        offerB = __pairNormal(__ds.main);
        let guard=0;
        while(guard++<30 && offerA.join('|')===offerB.join('|')){
          offerB = __pairNormal(__ds.main);
        }
        hintA='通常：A';
        hintB='通常：B';
      }
    }

    __offer = { A: offerA, B: offerB, hintA, hintB };
    __renderOffer();
  }

  function __cardLine(id){
    const c = __cardObjById(id);
    const m = c.meta || __metaOf(id) || {};
    const name = (m && m.name) ? m.name : (c && c.name ? c.name : id);
    const type = String(m.type||'—');
    const grade = (m.grade!=null && m.grade!=='') ? `等級${m.grade}` : '';
    const adv = (m.advance!=null && m.advance!=='') ? `進攻${m.advance}` : '';
    const color = String(m.color||'');
    const feats = Array.isArray(m.features) ? m.features : [];
    const feat = feats.length ? feats.slice(0,3).join(' / ') : '';
    const metaBits = [color, type, grade, adv].filter(Boolean).join(' / ');
    return `
      <div class="dCard" data-cardid="${__dEsc(id)}">
        <img src="${__dEsc(c.srcGuess||'')}" alt="${__dEsc(name)}" onerror="this.onerror=null;this.src='${WHITE_BACK}';">
        <div class="dTxt">
          <div class="dName">${__dEsc(name)}</div>
          <div class="dMeta">${__dEsc(metaBits || '—')}${feat?`<br>${__dEsc(feat)}`:''}</div>
        </div>
      </div>
    `;
  }

  // --- 2Pick内でもカード拡大（preview）を使えるようにする ---
  const __previewEl = document.getElementById('preview');
  function __openPreview2Pick(cardId){
    if(typeof openPreviewByCardId!=='function') return;
    // 2Pickモーダル(z-index:20000)より上に出す
    if(__previewEl && __previewEl.dataset){
      if(__previewEl.dataset._zRestore==null){
        __previewEl.dataset._zRestore = (__previewEl.style && __previewEl.style.zIndex!=null) ? __previewEl.style.zIndex : '';
      }
      __previewEl.style.zIndex = '26000';
    }
    openPreviewByCardId(cardId);
  }
  function __wireCardPreviewClicks(){
    const bind = (root)=>{
      if(!root) return;
      root.querySelectorAll('.dCard[data-cardid] img').forEach(img=>{
        img.addEventListener('click',(e)=>{
          e.preventDefault();
          e.stopPropagation(); // A/B選択とは別で拡大を開く
          const wrap = img.closest('.dCard');
          const id = wrap && wrap.dataset ? wrap.dataset.cardid : '';
          if(id) __openPreview2Pick(id);
        }, {passive:false});
      });
    };
    bind(__optA);
    bind(__optB);
  }

  function __renderOffer(){
    if(!__modal || !__offer) return;

    const mCnt = __sum(__ds.main);
    const kCnt = __sum(__ds.monster);

    const phaseText = (__ds.phase==='monster')
      ? `怪獣ドラフト：等級${__ds.grade}（${__ds.grade}/4）`
      : (__ds.phase==='main')
        ? `メインドラフト：${__ds.round+1}/${CFG.mainRounds}（${mCnt}/50）`
        : `完了（メイン${mCnt}/50・怪獣${kCnt}/4）`;

    const premLeft = (__ds.phase==='main')
      ? Array.from(__ds.premiumIdx).filter(i=>i>=__ds.round).length
      : CFG.premiumRounds;

    const rr = (__ds.phase==='monster')
      ? `リロール：怪獣 ${__ds.rerollM} / メイン ${__ds.rerollMain}`
      : `リロール：メイン ${__ds.rerollMain}`;

    __sub.textContent = `${phaseText}\n同名上限：${CFG.maxDup}枚 / 2進攻枠：最大${CFG.premiumRounds}回（残り目安 ${premLeft}）\n${rr}`;

    const isPremNow = (__ds.phase==='main' && __ds.premiumIdx.has(__ds.round));
    __msg.textContent = (__ds.phase==='done')
      ? `ドラフト完了！\nこのまま「構築画面へ反映」すると、デッキ構築に反映されます。`
      : (isPremNow
          ? `プレミア回：この選択で「進攻2」が1枚増えます（最大${CFG.premiumRounds}枚）。\n[1]でA / [2]でB / Enterで確定 / Rでリロール`
          : `[1]でA / [2]でB / Enterで確定 / Rでリロール`);

    const aCards = (__offer.A||[]).map(__cardLine).join('');
    const bCards = (__offer.B||[]).map(__cardLine).join('');

    __optA.innerHTML = `
      <div class="dOptHdr"><div class="dOptTag">A</div><div class="dOptHint">${__dEsc(__offer.hintA||'')}</div></div>
      <div class="dCards">${aCards || '<div style="opacity:.7">カードが見つかりません</div>'}</div>
    `;
    __optB.innerHTML = `
      <div class="dOptHdr"><div class="dOptTag">B</div><div class="dOptHint">${__dEsc(__offer.hintB||'')}</div></div>
      <div class="dCards">${bCards || '<div style="opacity:.7">カードが見つかりません</div>'}</div>
    `;

    __wireCardPreviewClicks();

    // selection UI
    __optA.classList.toggle('selected', __selected==='A');
    __optB.classList.toggle('selected', __selected==='B');

    // buttons
    const canPick = (__selected==='A' || __selected==='B') && __ds.phase!=='done';
    __btnPick.disabled = !canPick;

    const canReroll = (__ds.phase==='monster' ? (__ds.rerollM>0) : (__ds.phase==='main' ? (__ds.rerollMain>0) : false));
    __btnReroll.disabled = !canReroll;

    const done = (__ds.phase==='done');
    __btnApply.disabled = !done;
    __btnCopy.disabled = !done;
  }

  function __selectOpt(side){
    if(!__ds || __ds.phase==='done') return;
    if(side!=='A' && side!=='B') return;
    __selected = side;
    __optA.classList.toggle('selected', __selected==='A');
    __optB.classList.toggle('selected', __selected==='B');
    __btnPick.disabled = !(__selected==='A' || __selected==='B');
    try{ __panel.focus(); }catch(e){}
  }

  function __applyPick(ids){
    if(!Array.isArray(ids) || !ids.length) return false;

    if(__ds.phase==='monster'){
      const id = ids[0];
      if(!id || !__hasMeta(id)) return false;
      // 同名上限（ほぼ効かないが一応）
      if(!__canTake(__ds.monster,id)) return false;
      __ds.monster[id] = (__countOf(__ds.monster,id) + 1);
      __ds.grade++;
      if(__ds.grade>4){
        __ds.phase='main';
        __ds.round=0;
      }
      return true;
    }

    if(__ds.phase==='main'){
      // 2枚セット
      for(const id of ids){
        if(!id || !__hasMeta(id)) continue;
        if(!__canTake(__ds.main,id)) continue;
        __ds.main[id] = (__countOf(__ds.main,id) + 1);
      }
      __ds.round++;
      if(__ds.round>=CFG.mainRounds){
        __ds.phase='done';
      }
      return true;
    }

    return false;
  }

  function __confirmPick(){
    if(!__ds || __ds.phase==='done') return;
    if(!__selected) return;
    const ids = (__offer && __offer[__selected]) ? __offer[__selected] : [];
    const ok = __applyPick(ids);
    if(!ok){
      alert('この選択を反映できませんでした（カード情報が不足している可能性があります）');
      return;
    }
    __makeOffer();
  }

  function __doReroll(){
    if(!__ds || __ds.phase==='done') return;

    if(__ds.phase==='monster'){
      if(__ds.rerollM<=0) return;
      __ds.rerollM--;
      __makeOffer();
      return;
    }
    if(__ds.phase==='main'){
      if(__ds.rerollMain<=0) return;
      __ds.rerollMain--;
      __makeOffer();
      return;
    }
  }

  function __copyDeckCode(){
    if(!__ds || __ds.phase!=='done') return;
    let code='';
    try{
      if(typeof encodeDeck==='function'){
        code = encodeDeck({main:__ds.main, monster:__ds.monster});
      }
    }catch(e){}
    if(!code){ alert('デッキコード生成に失敗しました'); return; }

    (async ()=>{
      try{
        await navigator.clipboard.writeText(code);
        const old = __btnCopy.textContent;
        __btnCopy.textContent='コピー済み';
        setTimeout(()=>{ __btnCopy.textContent = old; }, 650);
      }catch(err){
        const ta=document.createElement('textarea');
        ta.value=code;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        const old = __btnCopy.textContent;
        __btnCopy.textContent='コピー済み';
        setTimeout(()=>{ __btnCopy.textContent = old; }, 650);
      }
    })();
  }

  function __applyToBuilder(){
    if(!__ds || __ds.phase!=='done') return;
    try{
      if(typeof applyDeckToBuilder==='function'){
        applyDeckToBuilder({main:__ds.main, monster:__ds.monster});
      }
      if(typeof openBuilder==='function') openBuilder();
      __closeDraft();
    }catch(e){
      alert('構築画面への反映に失敗しました: '+e.message);
    }
  }

  function __openDraft(){
    __ensureModal();
    __newSession();

    // 最初の提示
    __makeOffer();

    __modal.classList.remove('hidden');
    try{ __panel.focus(); }catch(e){}
  }

  function __closeDraft(){
    if(!__modal) return;
    __modal.classList.add('hidden');
    __ds=null; __offer=null; __selected=null;
  }

  // ---------- secret trigger ----------
  const SECRET_WORDS=['g2pick','2pick'];
  let __buf='', __last=0;
  function __canTrigger(){
    if(typeof IS_SPECTATOR!=='undefined' && IS_SPECTATOR) return false;

    // 入力中は無効
    const ae=document.activeElement;
    if(ae && (ae.tagName==='INPUT' || ae.tagName==='TEXTAREA' || ae.isContentEditable)) return false;

    // モーダル/ビルダー中は誤爆防止（draft以外）
    try{
      if(startModal && startModal.style.display!=='none') return false;
      if(viewer && !viewer.classList.contains('hidden')) return false;
      if(reveal && !reveal.classList.contains('hidden')) return false;
      if(tokenModal && !tokenModal.classList.contains('hidden')) return false;
      if(counterModal && !counterModal.classList.contains('hidden')) return false;
      if(stackModal && !stackModal.classList.contains('hidden')) return false;
      if(preview && !preview.classList.contains('hidden')) return false;
      if(builder && !builder.classList.contains('hidden')) return false;
    }catch(e){}
    return true;
  }

  window.openDraft2Pick = __openDraft;

  document.addEventListener('keydown',(e)=>{
    if(e.defaultPrevented || e.repeat) return;
    if(!__canTrigger()) return;

    const k=e.key;
    if(!k || k.length!==1) return;

    const now=Date.now();
    if(now-__last>1100) __buf='';
    __last=now;

    __buf = (__buf + k.toLowerCase()).slice(-12);
    if(SECRET_WORDS.some(w=>__buf.endsWith(w))){
      e.preventDefault();
      __buf='';
      __openDraft();
    }
  }, true);

})();

// ===== Remake: React migration bridge (non-breaking) =====
(function attachLegacyBridge(){
  if(typeof window==='undefined') return;
  const api = {
    version: 'remake-1',
    getStateSnapshot(){
      return {
        rageCount: (typeof rageCount!=='undefined') ? rageCount : null,
        cardCount: (typeof state!=='undefined' && Array.isArray(state?.order)) ? state.order.length : null,
        selectedIds: (typeof selection!=='undefined' && selection instanceof Set)
          ? Array.from(selection)
          : []
      };
    },
    forceRender(){
      try{
        if(typeof renderAllCards==='function') renderAllCards();
        if(typeof updateCounters==='function') updateCounters();
        if(typeof updateDeckCounter==='function') updateDeckCounter();
      }catch(e){
        console.warn('legacy forceRender failed', e);
      }
    }
  };
  window.GCardLegacyAPI = api;
  window.dispatchEvent(new CustomEvent('gcard:legacy-ready', { detail: { version: api.version } }));
})();
