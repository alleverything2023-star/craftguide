/* ==========================================================================
   Albion 装備クラフト原価計算ツール
   ========================================================================== */

const CATS = [
  {id:'head',   label:'頭防具',       ic:'🪖'},
  {id:'chest',  label:'胴防具',       ic:'👕'},
  {id:'foot',   label:'足防具',       ic:'👢'},
  {id:'cape',   label:'ケープ',       ic:'🧣'},
  {id:'weapon', label:'武器',         ic:'⚔️'},
  {id:'offhand',label:'オフハンド',   ic:'🛡️'},
];

const MATERIALS = [
  {id:'plank',   label:'木材 (Plank)'},
  {id:'steel',   label:'鋼 (Steel)'},
  {id:'leather', label:'革 (Leather)'},
  {id:'cloth',   label:'布 (Cloth)'},
];

const TIERS4to8 = [4,5,6,7,8];
const ENCH = [0,1,2,3,4];

// 装備カテゴリ内でのグループ（種類）表示順。元データ(0000albion_items)の順序に合わせてある。
const SUBTYPE_ORDER = {
  weapon: ['sword','axe','mace','hammer','fist','crossbow','bow','spear',
           'naturestaff','dagger','quarterstaff','shapeshifterstaff',
           'firestaff','holystaff','arcanestaff','froststaff','cursedstaff'],
  head:  ['plate','leather','cloth'],
  chest: ['plate','leather','cloth'],
  foot:  ['plate','leather','cloth'],
  offhand: ['shield','torch','tome'],
  cape: [null],
};

const SUBTYPE_LABELS = {
  sword:'ソード', axe:'アックス', mace:'メイス', hammer:'ハンマー',
  fist:'フィスト', crossbow:'クロスボウ', bow:'ボウ', spear:'スピア',
  naturestaff:'ネイチャースタッフ', dagger:'ダガー', quarterstaff:'クォータースタッフ',
  shapeshifterstaff:'シェイプシフタースタッフ', firestaff:'ファイアスタッフ',
  holystaff:'ホーリースタッフ', arcanestaff:'アルケインスタッフ',
  froststaff:'フロストスタッフ', cursedstaff:'カースドスタッフ',
  plate:'プレート', leather:'レザー', cloth:'クロス',
  shield:'シールド', torch:'トーチ', tome:'魔導書',
};

function isArtifactItem(item){
  return !!(item.materials && item.materials.artifact > 0);
}

/* ---------------------------------------------------------------------
   Persistent state (localStorage)
--------------------------------------------------------------------- */
const LS_KEY = 'albion_calc_state_v3';

function defaultSettings(){
  return {
    tier:4, ench:0,               // 作成リストで実際に作るティア・補正段階
    cityBonus:true, focus:false,  // 還元率：都市専門ボーナス／フォーカス使用
    stationFee:0,
    saleType:'quick', premium:true, setupFeeRate:2.5,
  };
}

function defaultState(){
  return {
    prices:{},          // prices["plank_T4_1"] = 1234
    artifactPrices:{},  // artifactPrices["T6"] = 5000
    sellPrices:{},      // sellPrices["itemId_T4_0"] = 45000
    bonusItems:{},       // bonusItems["itemId"] = 10 | 20  （その日の日替わり生産ボーナス）
    settings: defaultSettings(),
    craftList:{},        // craftList["itemId"] = qty
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(raw) return Object.assign(defaultState(), JSON.parse(raw));
  }catch(e){}

  // v2（利益率タブがあった旧バージョン）からの簡易移行
  try{
    const oldRaw = localStorage.getItem('albion_calc_state_v2');
    if(oldRaw){
      const old = JSON.parse(oldRaw);
      const s = defaultState();
      s.prices = old.prices || {};
      s.artifactPrices = old.artifactPrices || {};
      s.sellPrices = old.sellPrices || {};
      s.craftList = old.craftList || {};
      if(old.settings){
        s.settings.tier = old.settings.tier || 4;
        s.settings.ench = old.settings.ench || 0;
        s.settings.cityBonus = old.settings.cityBonus !== undefined ? old.settings.cityBonus : true;
        s.settings.focus = !!old.settings.focus;
        s.settings.stationFee = old.settings.stationFee || 0;
        s.settings.saleType = old.settings.saleType || 'quick';
        s.settings.premium = old.settings.premium !== undefined ? old.settings.premium : true;
        s.settings.setupFeeRate = old.settings.setupFeeRate !== undefined ? old.settings.setupFeeRate : 2.5;
      }
      return s;
    }
  }catch(e){}

  return defaultState();
}
let STATE = loadState();

function saveState(){
  localStorage.setItem(LS_KEY, JSON.stringify(STATE));
}

/* ---------------------------------------------------------------------
   Utility
--------------------------------------------------------------------- */
function fmt(n){
  n = Math.round(n||0);
  return n.toLocaleString('en-US');
}
function priceKey(material, tier, ench){
  return `${material}_T${tier}_${ench}`;
}
function getPrice(material, tier, ench){
  return Number(STATE.prices[priceKey(material,tier,ench)] || 0);
}
function setPrice(material, tier, ench, val){
  STATE.prices[priceKey(material,tier,ench)] = val;
  saveState();
}
function getArtifactPrice(tier){
  return Number(STATE.artifactPrices['T'+tier] || 0);
}
function sellKey(itemId, tier, ench){
  return `${itemId}_T${tier}_${ench}`;
}
function getSellPrice(itemId, tier, ench){
  return Number(STATE.sellPrices[sellKey(itemId, tier, ench)] || 0);
}
function setSellPrice(itemId, tier, ench, val){
  STATE.sellPrices[sellKey(itemId, tier, ench)] = val;
  saveState();
}
function getBonus(itemId){
  return Number(STATE.bonusItems[itemId] || 0); // 0 / 10 / 20
}
function setBonus(itemId, val){
  if(!val){ delete STATE.bonusItems[itemId]; }
  else STATE.bonusItems[itemId] = val;
  saveState();
}

/* ---------------------------------------------------------------------
   Resource Return Rate（Albion Online Wiki: Resource return rate に準拠）
     - 王都クラフトステーションの基本生産ボーナス：       +18%
     - 専門化（ボーナスシティ）でのクラフトボーナス：      +15%
     - フォーカス使用：                                    +59%（固定）
     - 日替わり生産ボーナス：その日選ばれた2アイテムのみ   +10% or +20%
       （アイテムごとに異なるため、対象アイテムは「原価入力 > ボーナスデー」で個別登録）
   RRR = bonus / (100 + bonus)
--------------------------------------------------------------------- */
function calcRRR(opts, item){
  let bonus = 18; // 常時：王都クラフトステーションの基本ボーナス
  if(opts.cityBonus) bonus += 15;
  if(opts.focus) bonus += 59;
  if(item) bonus += getBonus(item.id); // 0 / 10 / 20（登録されたアイテムのみ）
  const rrr = bonus / (100 + bonus);
  return {rrr, bonus};
}

function computeItemCost(item, tier, ench){
  const s = STATE.settings;
  const {rrr, bonus} = calcRRR(s, item);
  const m = item.materials || {plank:0,steel:0,leather:0,cloth:0,artifact:0};

  const breakdown = MATERIALS.map(mat=>{
    const rawQty = Number(m[mat.id])||0;
    const unitPrice = getPrice(mat.id, tier, ench);
    const grossCost = rawQty * unitPrice;         // 還元前の素材コスト
    const returnedValue = grossCost * rrr;         // 還元される分の金額
    const netCost = grossCost - returnedValue;      // 実質コスト
    return {id:mat.id, label:mat.label, rawQty, unitPrice, grossCost, returnedValue, netCost};
  }).filter(b=>b.rawQty>0);

  const grossMaterialCost = breakdown.reduce((sum,b)=>sum+b.grossCost, 0);
  const returnedValue = breakdown.reduce((sum,b)=>sum+b.returnedValue, 0);
  const netMaterialCost = grossMaterialCost - returnedValue;

  const artifactQty = Number(m.artifact)||0;
  const artifactCost = artifactQty * getArtifactPrice(tier); // アーティファクトは還元対象外

  const stationFee = Number(s.stationFee)||0;
  const grossTotal = grossMaterialCost + artifactCost;               // 還元前の原価
  const total = netMaterialCost + artifactCost + stationFee;          // 実質原価合計（製造料込み）

  return {breakdown, rrr, bonus, grossMaterialCost, returnedValue, netMaterialCost,
           artifactQty, artifactCost, stationFee, grossTotal, total};
}

function computeNetSell(sellPrice){
  const s = STATE.settings;
  const taxRate = s.premium ? 4 : 8;
  const setupRate = s.saleType === 'order' ? Number(s.setupFeeRate)||0 : 0;
  const setupFee = sellPrice * (setupRate/100);
  const tax = sellPrice * (taxRate/100) + setupFee;
  const net = sellPrice - tax;
  return {taxRate, setupRate, setupFee, tax, net};
}

function computeProfit(item, tier, ench){
  const cost = computeItemCost(item, tier, ench);
  const sellPrice = getSellPrice(item.id, tier, ench);
  const {net, tax} = computeNetSell(sellPrice);
  const profit = net - cost.total;
  const margin = sellPrice>0 ? (profit/sellPrice*100) : 0;
  return {cost, sellPrice, net, tax, profit, margin};
}

/* ---------------------------------------------------------------------
   Tab switching
--------------------------------------------------------------------- */
document.querySelectorAll('.tabbtn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tabbtn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const page = btn.dataset.page;
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.getElementById('page-'+page).classList.add('active');
    if(page==='build') renderBuildPage();
    if(page==='reco') renderRecoPage();
  });
});

document.querySelectorAll('.subtabbtn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.subtabbtn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.subpage').forEach(p=>p.style.display='none');
    document.getElementById('sub-'+btn.dataset.sub).style.display = '';
    if(btn.dataset.sub==='equip') renderEquipPricePage();
    if(btn.dataset.sub==='bonus') renderBonusPage();
  });
});

document.getElementById('resetBtn').addEventListener('click', ()=>{
  if(confirm('すべての価格・設定をリセットしますか？')){
    localStorage.removeItem(LS_KEY);
    STATE = defaultState();
    buildRefinedGrid();
    buildArtifactGrid();
    renderEquipPricePage();
    renderBonusPage();
    renderBuildPage();
    renderRecoPage();
    updateTopProfit();
  }
});

/* =======================================================================
   PAGE 1-A: 精製素材 price grid
======================================================================= */
function buildRefinedGrid(){
  const wrap = document.getElementById('refinedGrid');
  wrap.innerHTML = '';
  MATERIALS.forEach(mat=>{
    const col = document.createElement('div');
    col.className = 'pricecol';
    let html = `<h5>${mat.label}</h5>`;
    [1,2,3].forEach(t=> html += rowHtml(mat.id, t, 0, `T${t}`) );
    TIERS4to8.forEach(t=> ENCH.forEach(e=> html += rowHtml(mat.id, t, e, `T${t}.${e}`) ));
    col.innerHTML = html;
    wrap.appendChild(col);
  });

  wrap.querySelectorAll('input[data-mat]').forEach(inp=>{
    inp.value = getPrice(inp.dataset.mat, inp.dataset.tier, inp.dataset.ench) || '';
    inp.addEventListener('input', ()=>{
      setPrice(inp.dataset.mat, inp.dataset.tier, inp.dataset.ench, Number(inp.value)||0);
      updateTopProfit();
    });
  });
}
function rowHtml(matId, tier, ench, label){
  return `<div class="prow"><label>${label}</label>
    <input type="number" min="0" placeholder="0" data-mat="${matId}" data-tier="${tier}" data-ench="${ench}"></div>`;
}

function buildArtifactGrid(){
  const wrap = document.getElementById('artifactGrid');
  wrap.innerHTML = '';
  const col = document.createElement('div');
  col.className = 'pricecol';
  col.style.maxWidth = '280px';
  let html = `<h5>アーティファクト欠片</h5>`;
  TIERS4to8.forEach(t=>{
    html += `<div class="prow"><label>T${t}</label>
      <input type="number" min="0" placeholder="0" data-artifact-tier="${t}"></div>`;
  });
  col.innerHTML = html;
  wrap.appendChild(col);

  wrap.querySelectorAll('input[data-artifact-tier]').forEach(inp=>{
    inp.value = getArtifactPrice(inp.dataset.artifactTier) || '';
    inp.addEventListener('input', ()=>{
      STATE.artifactPrices['T'+inp.dataset.artifactTier] = Number(inp.value)||0;
      saveState();
      updateTopProfit();
    });
  });
}

/* =======================================================================
   PAGE 1-C: 装備売値 — カテゴリ→種類(画像)→価格グリッド、1項目だけ開く
======================================================================= */
let equipCategory = 'weapon';
let equipOpenKey = null; // "category::subtype" -- 一度に1つだけ開く

function renderEquipPricePage(){
  const catRow = document.getElementById('equipCatRow');
  catRow.innerHTML = '';
  CATS.forEach(c=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'equipcatbtn' + (c.id===equipCategory ? ' active' : '');
    btn.innerHTML = `<span class="ic">${c.ic}</span>${c.label}`;
    btn.addEventListener('click', ()=>{
      equipCategory = c.id;
      equipOpenKey = null;
      renderEquipPricePage();
    });
    catRow.appendChild(btn);
  });

  const subRow = document.getElementById('equipSubtypeRow');
  const panelWrap = document.getElementById('equipGridPanel');
  subRow.innerHTML = '';
  panelWrap.innerHTML = '';

  const order = SUBTYPE_ORDER[equipCategory] || [null];
  const groups = order.map(sub=>({
    sub,
    label: sub===null ? (CATS.find(c=>c.id===equipCategory)||{}).label : (SUBTYPE_LABELS[sub]||sub),
    items: ITEMS.filter(i=>i.category===equipCategory && i.subtype===sub),
  })).filter(g=>g.items.length>0);

  if(groups.length===1 && groups[0].sub===null){
    // ケープのようにサブタイプが無いカテゴリ：直接グリッドを表示
    subRow.style.display = 'none';
    renderEquipGrid(panelWrap, groups[0]);
    return;
  }
  subRow.style.display = '';

  groups.forEach(g=>{
    const key = equipCategory+'::'+g.sub;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'subtypeicon' + (equipOpenKey===key ? ' active' : '');
    btn.innerHTML = `<img src="${g.items[0].file}" alt=""><span>${g.label}</span><span class="micount">${g.items.length}</span>`;
    btn.addEventListener('click', ()=>{
      equipOpenKey = (equipOpenKey===key) ? null : key;
      renderEquipPricePage();
    });
    subRow.appendChild(btn);

    if(equipOpenKey===key){
      renderEquipGrid(panelWrap, g);
    }
  });
}

function renderEquipGrid(panelWrap, g){
  const panel = document.createElement('div');
  panel.className = 'equipgridpanel';
  panel.innerHTML = `<div class="pricegrid" id="equipPriceGrid"></div>`;
  panelWrap.appendChild(panel);

  const grid = panel.querySelector('#equipPriceGrid');
  g.items.forEach(item=>{
    const col = document.createElement('div');
    col.className = 'pricecol equipcol';
    let html = `<h5><img class="colthumb" src="${item.file}" alt="">${item.name}${isArtifactItem(item)?'<span class="tag-artifact">Artifact</span>':''}</h5>`;
    TIERS4to8.forEach(t=>{
      ENCH.forEach(e=>{
        html += `<div class="prow"><label>T${t}.${e}</label>
          <input type="number" min="0" placeholder="0" data-item="${item.id}" data-tier="${t}" data-ench="${e}"></div>`;
      });
    });
    col.innerHTML = html;
    grid.appendChild(col);
  });

  grid.querySelectorAll('input[data-item]').forEach(inp=>{
    inp.value = getSellPrice(inp.dataset.item, inp.dataset.tier, inp.dataset.ench) || '';
    inp.addEventListener('input', ()=>{
      setSellPrice(inp.dataset.item, Number(inp.dataset.tier), Number(inp.dataset.ench), Number(inp.value)||0);
      updateTopProfit();
    });
  });
}

/* =======================================================================
   PAGE 1-D: ボーナスデー — その日ボーナス対象のアイテムを個別登録
======================================================================= */
let bonusSearchTerm = '';

function renderBonusPage(){
  const active = Object.keys(STATE.bonusItems);
  const activeWrap = document.getElementById('bonusActiveList');
  if(active.length===0){
    activeWrap.innerHTML = `<div class="empty-hint">まだ登録されていません。下の検索から今日のボーナス対象アイテムを探して登録してください。</div>`;
  }else{
    activeWrap.innerHTML = active.map(id=>{
      const item = ITEMS.find(i=>i.id===id);
      if(!item) return '';
      const val = STATE.bonusItems[id];
      return `<div class="bonuschip">
        <img src="${item.file}" alt="">
        <span>${item.name}</span>
        <span class="bonuspct">+${val}%</span>
        <button type="button" class="tinybtn removebtn" data-id="${id}">解除</button>
      </div>`;
    }).join('');
    activeWrap.querySelectorAll('.removebtn').forEach(b=>{
      b.addEventListener('click', ()=>{ setBonus(b.dataset.id, 0); renderBonusPage(); updateTopProfit(); });
    });
  }

  const search = document.getElementById('bonusSearch');
  search.value = bonusSearchTerm;
  search.oninput = e=>{ bonusSearchTerm = e.target.value.trim().toLowerCase(); renderBonusPage(); };

  const listWrap = document.getElementById('bonusSearchList');
  if(!bonusSearchTerm){
    listWrap.innerHTML = `<div class="empty-hint">装備名を検索してボーナス（+10% または +20%）を設定してください。</div>`;
    return;
  }
  const matches = ITEMS.filter(i=>i.name.toLowerCase().includes(bonusSearchTerm)).slice(0,40);
  if(matches.length===0){
    listWrap.innerHTML = `<div class="empty-hint">該当する装備が見つかりません</div>`;
    return;
  }
  listWrap.innerHTML = '';
  matches.forEach(item=>{
    const cur = getBonus(item.id);
    const row = document.createElement('div');
    row.className = 'itemrow';
    row.innerHTML = `
      <img src="${item.file}" alt="${item.name}">
      <div class="irname">${item.name}${isArtifactItem(item)?'<span class="tag-artifact">Artifact</span>':''}</div>
      <div class="bonustoggle">
        <button type="button" class="bnbtn ${cur===0?'active':''}" data-v="0">なし</button>
        <button type="button" class="bnbtn ${cur===10?'active':''}" data-v="10">+10%</button>
        <button type="button" class="bnbtn ${cur===20?'active':''}" data-v="20">+20%</button>
      </div>
    `;
    row.querySelectorAll('.bnbtn').forEach(b=>{
      b.addEventListener('click', ()=>{
        setBonus(item.id, Number(b.dataset.v));
        renderBonusPage();
        updateTopProfit();
      });
    });
    listWrap.appendChild(row);
  });
}

/* =======================================================================
   共通設定バー（RRR・製造料・売却手数料）— 作成リストで使用
======================================================================= */
function renderSettingsBar(container, opts){
  const s = STATE.settings;
  container.innerHTML = `
    <div class="card settingsbar">
      <div class="settingsbar-row">
        <div class="field" style="max-width:110px;">
          <label>ティア</label>
          <select id="stTier">
            ${TIERS4to8.map(t=>`<option value="${t}" ${t==s.tier?'selected':''}>T${t}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="max-width:110px;">
          <label>補正段階</label>
          <select id="stEnch">
            ${ENCH.map(e=>`<option value="${e}" ${e==s.ench?'selected':''}>.${e}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="max-width:150px;">
          <label>ステーション使用料</label>
          <input type="number" id="stStationFee" min="0" value="${s.stationFee||0}">
        </div>
        <div class="field" style="max-width:150px;">
          <label>売却方法</label>
          <select id="stSaleType">
            <option value="quick" ${s.saleType==='quick'?'selected':''}>クイック売却</option>
            <option value="order" ${s.saleType==='order'?'selected':''}>売り注文</option>
          </select>
        </div>
        <div class="field" style="max-width:130px;">
          <label>出品手数料%</label>
          <input type="number" id="stSetupFeeRate" min="0" step="0.1" value="${s.setupFeeRate}" ${s.saleType!=='order'?'disabled':''}>
        </div>
        <label class="minitoggle">
          <input type="checkbox" id="stPremium" ${s.premium?'checked':''}>
          <span class="slider"></span>
          <span class="mtlabel">プレミアム</span>
        </label>
        <label class="minitoggle">
          <input type="checkbox" id="stCityBonus" ${s.cityBonus?'checked':''}>
          <span class="slider"></span>
          <span class="mtlabel">ボーナスシティ(+15%)</span>
        </label>
        <label class="minitoggle">
          <input type="checkbox" id="stFocus" ${s.focus?'checked':''}>
          <span class="slider"></span>
          <span class="mtlabel">フォーカス使用(+59%)</span>
        </label>
        <div class="pill" style="margin-left:auto;">基本還元率 <b id="stRRR">${(calcRRR(s).rrr*100).toFixed(2)}%</b></div>
      </div>
      <div class="note">日替わりボーナス（+10%/+20%）は「原価入力 &gt; ボーナスデー」で登録した対象アイテムにのみ自動で加算されます。</div>
    </div>
  `;

  document.getElementById('stTier').addEventListener('change', e=>{ s.tier=Number(e.target.value); saveState(); opts.onChange(); updateTopProfit(); });
  document.getElementById('stEnch').addEventListener('change', e=>{ s.ench=Number(e.target.value); saveState(); opts.onChange(); updateTopProfit(); });
  document.getElementById('stStationFee').addEventListener('input', e=>{ s.stationFee=Number(e.target.value)||0; saveState(); opts.onChange(); updateTopProfit(); });
  document.getElementById('stSaleType').addEventListener('change', e=>{ s.saleType=e.target.value; saveState(); opts.onChange(); updateTopProfit(); });
  document.getElementById('stSetupFeeRate').addEventListener('input', e=>{ s.setupFeeRate=Number(e.target.value)||0; saveState(); opts.onChange(); updateTopProfit(); });
  document.getElementById('stPremium').addEventListener('change', e=>{ s.premium=e.target.checked; saveState(); opts.onChange(); updateTopProfit(); });
  document.getElementById('stCityBonus').addEventListener('change', e=>{ s.cityBonus=e.target.checked; saveState(); opts.onChange(); updateTopProfit(); });
  document.getElementById('stFocus').addEventListener('change', e=>{ s.focus=e.target.checked; saveState(); opts.onChange(); updateTopProfit(); });
}

/* =======================================================================
   グループ化されたアイテムピッカー（種類ごとに折りたたみ）— 作成リストで使用
======================================================================= */
const pickerUIState = {
  activeCategory: {build:'head'},
  searchTerm: {build:''},
  expandedGroups: {build:new Set()},
};

function groupKey(category, sub){
  return category + '::' + (sub===null || sub===undefined ? '_all' : sub);
}

function buildGroups(category, list){
  const order = SUBTYPE_ORDER[category] || [...new Set(list.map(i=>i.subtype))];
  return order.map(sub=>({
    sub,
    label: sub===null ? (CATS.find(c=>c.id===category)||{}).label : (SUBTYPE_LABELS[sub] || sub),
    items: list.filter(i=>i.subtype===sub),
  })).filter(g=>g.items.length>0);
}

function renderItemPicker(pageId, wrap, renderRow){
  wrap.innerHTML = '';
  const cat = pickerUIState.activeCategory[pageId];
  const term = pickerUIState.searchTerm[pageId];
  const expanded = pickerUIState.expandedGroups[pageId];

  let list = ITEMS.filter(i=>i.category===cat);
  if(term) list = ITEMS.filter(i=>i.name.toLowerCase().includes(term));

  if(list.length===0){
    wrap.innerHTML = `<div class="empty-hint">該当する装備が見つかりません</div>`;
    return;
  }

  const groups = term ? [{sub:null, label:'検索結果', items:list}] : buildGroups(cat, list);
  const forceOpen = !!term;

  const toolbar = document.createElement('div');
  toolbar.className = 'grouptoolbar';
  toolbar.innerHTML = `<button type="button" class="tinybtn" data-act="expand">すべて展開</button><button type="button" class="tinybtn" data-act="collapse">すべて折りたたむ</button>`;
  wrap.appendChild(toolbar);
  toolbar.querySelector('[data-act=expand]').addEventListener('click', ()=>{
    groups.forEach(g=>expanded.add(groupKey(cat, g.sub)));
    renderItemPicker(pageId, wrap, renderRow);
  });
  toolbar.querySelector('[data-act=collapse]').addEventListener('click', ()=>{
    groups.forEach(g=>expanded.delete(groupKey(cat, g.sub)));
    renderItemPicker(pageId, wrap, renderRow);
  });

  groups.forEach(g=>{
    const key = groupKey(cat, g.sub);
    const isOpen = forceOpen || expanded.has(key);
    const label = g.label===null ? (CATS.find(c=>c.id===cat)||{}).label : g.label;
    const repImg = g.items[0].file;

    const el = document.createElement('div');
    el.className = 'subgroup' + (isOpen ? '' : ' collapsed');

    const header = document.createElement('div');
    header.className = 'subgroup-header';
    header.innerHTML = `
      <span class="stt"><img class="rep-thumb" src="${repImg}" alt=""> ${label}<span class="scount">${g.items.length}</span></span>
      <span class="chev">▾</span>`;
    header.addEventListener('click', ()=>{
      if(expanded.has(key)) expanded.delete(key); else expanded.add(key);
      renderItemPicker(pageId, wrap, renderRow);
    });
    el.appendChild(header);

    const body = document.createElement('div');
    body.className = 'subgroup-body';
    const rowsWrap = document.createElement('div');
    rowsWrap.className = 'itemrows';
    g.items.forEach(item=>rowsWrap.appendChild(renderRow(item)));
    body.appendChild(rowsWrap);
    el.appendChild(body);

    wrap.appendChild(el);
  });
}

function renderCategorySidebar(pageId, wrap, onSelect){
  wrap.innerHTML = '';
  CATS.forEach(c=>{
    const count = ITEMS.filter(i=>i.category===c.id).length;
    const btn = document.createElement('button');
    btn.className = 'catbtn' + (c.id===pickerUIState.activeCategory[pageId] ? ' active':'');
    btn.innerHTML = `<span class="ic">${c.ic}</span>${c.label}<span class="catcount">${count}</span>`;
    btn.addEventListener('click', ()=>{
      pickerUIState.activeCategory[pageId] = c.id;
      renderCategorySidebar(pageId, wrap, onSelect);
      onSelect();
    });
    wrap.appendChild(btn);
  });
}

/* =======================================================================
   PAGE 2: 作成リスト — 原価・製造料・還元額・税金・合計・利益・利益率
======================================================================= */
function addToCraftList(itemId){
  STATE.craftList[itemId] = (STATE.craftList[itemId]||0) + 1;
  saveState();
  renderBuildPage();
}
function setCraftQty(itemId, qty){
  qty = Math.max(0, Number(qty)||0);
  if(qty===0){ delete STATE.craftList[itemId]; }
  else STATE.craftList[itemId] = qty;
  saveState();
  renderBuildPage();
}
function removeFromCraftList(itemId){
  delete STATE.craftList[itemId];
  saveState();
  renderBuildPage();
}

function renderBuildPage(){
  renderSettingsBar(document.getElementById('buildSettingsBar'), {onChange: renderBuildPage});
  renderCategorySidebar('build', document.getElementById('buildCategoryList'), renderBuildPage);

  const search = document.getElementById('buildSearch');
  search.value = pickerUIState.searchTerm.build;
  search.oninput = (e)=>{ pickerUIState.searchTerm.build = e.target.value.trim().toLowerCase(); renderBuildPage(); };

  renderItemPicker('build', document.getElementById('buildItemList'), (item)=>{
    const qty = STATE.craftList[item.id]||0;
    const row = document.createElement('div');
    row.className = 'itemrow';
    row.innerHTML = `
      <img src="${item.file}" alt="${item.name}">
      <div class="irname">${item.name}${isArtifactItem(item)?'<span class="tag-artifact">Artifact</span>':''}</div>
      <div class="irfield" style="max-width:110px;">
        <input type="number" min="0" placeholder="0" value="${qty||''}">
      </div>
      <button type="button" class="tinybtn addbtn">${qty>0?'追加(+1)':'リストに追加'}</button>
    `;
    row.querySelector('input').addEventListener('input', e=>setCraftQty(item.id, e.target.value));
    row.querySelector('.addbtn').addEventListener('click', ()=>addToCraftList(item.id));
    return row;
  });

  renderCraftListPanel();
}

function renderCraftListPanel(){
  const wrap = document.getElementById('craftListPanel');
  const s = STATE.settings;
  const entries = Object.keys(STATE.craftList)
    .map(id=>({item: ITEMS.find(i=>i.id===id), qty: STATE.craftList[id]}))
    .filter(e=>e.item && e.qty>0);

  if(entries.length===0){
    wrap.innerHTML = `<div class="empty-hint">左のリストから装備を選んで「追加」すると、ここに原価・利益の内訳がまとまります</div>`;
    return;
  }

  const totals = {gross:0, returned:0, station:0, artifact:0, cost:0, sell:0, tax:0, profit:0};

  const rows = entries.map(({item, qty})=>{
    const c = computeItemCost(item, s.tier, s.ench);
    const sellPrice = getSellPrice(item.id, s.tier, s.ench);
    const {net, tax} = computeNetSell(sellPrice);
    const profit = (net - c.total) * qty;
    const margin = sellPrice>0 ? ((net-c.total)/sellPrice*100) : 0;

    totals.gross += c.grossTotal*qty;
    totals.returned += c.returnedValue*qty;
    totals.station += c.stationFee*qty;
    totals.artifact += c.artifactCost*qty;
    totals.cost += c.total*qty;
    totals.sell += sellPrice*qty;
    totals.tax += tax*qty;
    totals.profit += profit;

    return `
      <div class="buildrow">
        <div class="brhead">
          <img src="${item.file}" alt="${item.name}">
          <div class="irname">${item.name}${isArtifactItem(item)?'<span class="tag-artifact">Artifact</span>':''}</div>
          <input type="number" min="0" class="craftqty" data-id="${item.id}" value="${qty}">
          <button type="button" class="tinybtn removebtn" data-id="${item.id}">削除</button>
        </div>
        <div class="brstats">
          <div class="bstat"><span class="bk">原価(素材)</span><span class="bv">${fmt(c.grossMaterialCost)}</span></div>
          <div class="bstat"><span class="bk">還元額</span><span class="bv profit-pos">-${fmt(c.returnedValue)}</span></div>
          <div class="bstat"><span class="bk">アーティファクト</span><span class="bv">${fmt(c.artifactCost)}</span></div>
          <div class="bstat"><span class="bk">製造料</span><span class="bv">${fmt(c.stationFee)}</span></div>
          <div class="bstat"><span class="bk">実質原価計</span><span class="bv strong">${fmt(c.total)}</span></div>
          <div class="bstat"><span class="bk">売値</span><span class="bv">${fmt(sellPrice)}</span></div>
          <div class="bstat"><span class="bk">税金・手数料</span><span class="bv">-${fmt(tax)}</span></div>
          <div class="bstat"><span class="bk">利益（×${qty}）</span><span class="bv ${profit>=0?'profit-pos':'profit-neg'} strong">${profit>=0?'+':''}${fmt(profit)}</span></div>
          <div class="bstat"><span class="bk">利益率</span><span class="bv ${margin>=0?'profit-pos':'profit-neg'}">${sellPrice>0?margin.toFixed(1)+'%':'—'}</span></div>
        </div>
      </div>`;
  }).join('');

  const totalMargin = totals.sell>0 ? (totals.profit/totals.sell*100) : 0;

  wrap.innerHTML = `
    <div class="card">
      <h3>作成リスト（${entries.length}種 / T${s.tier}.${s.ench}で計算）</h3>
      <div class="buildrows">${rows}</div>
    </div>
    <div class="card summary-box">
      <div class="summary-title">合計</div>
      <div class="srow"><span class="k">素材原価（還元前）</span><span class="v">${fmt(totals.gross-totals.artifact)}</span></div>
      <div class="srow"><span class="k">還元額</span><span class="v profit-pos">-${fmt(totals.returned)}</span></div>
      <div class="srow"><span class="k">アーティファクト代</span><span class="v">${fmt(totals.artifact)}</span></div>
      <div class="srow"><span class="k">製造料</span><span class="v">${fmt(totals.station)}</span></div>
      <div class="srow"><span class="k">実質原価合計</span><span class="v">${fmt(totals.cost)}</span></div>
      <div class="srow"><span class="k">売値合計</span><span class="v">${fmt(totals.sell)}</span></div>
      <div class="srow"><span class="k">税金・出品手数料</span><span class="v">-${fmt(totals.tax)}</span></div>
      <div class="srow total"><span class="k">合計利益</span><span class="v ${totals.profit>=0?'profit-pos':'profit-neg'}">${totals.profit>=0?'+':''}${fmt(totals.profit)}</span></div>
      <div class="srow"><span class="k">合計利益率</span><span class="v ${totalMargin>=0?'profit-pos':'profit-neg'}">${totals.sell>0?totalMargin.toFixed(1)+'%':'—'}</span></div>
    </div>
  `;

  wrap.querySelectorAll('.craftqty').forEach(inp=>{
    inp.addEventListener('input', e=>setCraftQty(e.target.dataset.id, e.target.value));
  });
  wrap.querySelectorAll('.removebtn').forEach(btn=>{
    btn.addEventListener('click', e=>removeFromCraftList(e.target.dataset.id));
  });
}

/* =======================================================================
   PAGE 3: おすすめ — 利益率の高いアイテムを提案
======================================================================= */
function renderRecoPage(){
  const wrap = document.getElementById('recoList');
  const s = STATE.settings;

  const results = [];
  ITEMS.forEach(item=>{
    TIERS4to8.forEach(t=>{
      ENCH.forEach(e=>{
        const sp = getSellPrice(item.id, t, e);
        if(sp<=0) return;
        const c = computeItemCost(item, t, e);
        const {net} = computeNetSell(sp);
        const profit = net - c.total;
        const margin = profit/sp*100;
        results.push({item, tier:t, ench:e, sellPrice:sp, cost:c.total, profit, margin});
      });
    });
  });

  if(results.length===0){
    wrap.innerHTML = `<div class="empty-hint">「原価入力 &gt; 装備売値」で売値を入力すると、利益率の高い装備がここに表示されます</div>`;
    return;
  }

  results.sort((a,b)=>b.margin-a.margin);
  const top = results.slice(0,30);

  wrap.innerHTML = `
    <div class="card">
      <h3>利益率トップ ${top.length}</h3>
      <div class="sub">現在入力済みの売値をもとに、利益率が高い順に表示しています（還元率・手数料は共通設定を使用）。</div>
      <div class="recorows">
        ${top.map((r,idx)=>`
          <div class="recorow">
            <span class="rerank">${idx+1}</span>
            <img src="${r.item.file}" alt="${r.item.name}">
            <div class="irname">${r.item.name} <span class="retier">T${r.tier}.${r.ench}</span>${isArtifactItem(r.item)?'<span class="tag-artifact">Artifact</span>':''}</div>
            <div class="bstat"><span class="bk">原価</span><span class="bv">${fmt(r.cost)}</span></div>
            <div class="bstat"><span class="bk">売値</span><span class="bv">${fmt(r.sellPrice)}</span></div>
            <div class="bstat"><span class="bk">利益</span><span class="bv ${r.profit>=0?'profit-pos':'profit-neg'}">${r.profit>=0?'+':''}${fmt(r.profit)}</span></div>
            <div class="bstat"><span class="bk">利益率</span><span class="bv ${r.margin>=0?'profit-pos':'profit-neg'} strong">${r.margin.toFixed(1)}%</span></div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/* =======================================================================
   共通：トップバーの概算利益表示（作成リスト合計の利益）
======================================================================= */
function updateTopProfit(){
  const el = document.getElementById('topProfit');
  const s = STATE.settings;
  const entries = Object.keys(STATE.craftList)
    .map(id=>({item: ITEMS.find(i=>i.id===id), qty: STATE.craftList[id]}))
    .filter(e=>e.item && e.qty>0);

  if(entries.length===0){ el.textContent='—'; return; }

  let totalProfit = 0, any = false;
  entries.forEach(({item, qty})=>{
    const p = computeProfit(item, s.tier, s.ench);
    if(p.sellPrice>0){ totalProfit += p.profit*qty; any = true; }
  });
  if(!any){ el.textContent='—'; return; }
  el.textContent = (totalProfit>=0?'+':'') + fmt(totalProfit) + ' silver';
  el.style.color = totalProfit>=0 ? 'var(--green)' : 'var(--red)';
}

/* =======================================================================
   Init
======================================================================= */
buildRefinedGrid();
buildArtifactGrid();
renderEquipPricePage();
renderBonusPage();
renderBuildPage();
renderRecoPage();
updateTopProfit();
