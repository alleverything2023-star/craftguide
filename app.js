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
const LS_KEY = 'albion_calc_state_v2';
const LS_KEY_OLD = 'albion_calc_state_v1';

function defaultSettings(){
  return {
    tier:4, ench:0,
    cityBonus:true, focus:false, bonusDay:'none', // none/silver/gold
    stationFee:0,
    saleType:'quick', premium:true, setupFeeRate:2.5,
  };
}

function defaultState(){
  return {
    prices:{},         // prices["plank_T4_1"] = 1234
    artifactPrices:{},// artifactPrices["T6"] = 5000
    settings: defaultSettings(),
    sellPrices:{},      // sellPrices["itemId_T4_0"] = 45000
    craftList:{},       // craftList["itemId"] = qty
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(raw) return Object.assign(defaultState(), JSON.parse(raw));
  }catch(e){}

  // migrate from the old single-item calculator (v1) if present
  try{
    const oldRaw = localStorage.getItem(LS_KEY_OLD);
    if(oldRaw){
      const old = JSON.parse(oldRaw);
      const s = defaultState();
      s.prices = old.prices || {};
      s.artifactPrices = old.artifactPrices || {};
      if(old.recipe){
        s.settings.tier = old.recipe.tier || 4;
        s.settings.ench = old.recipe.ench || 0;
        s.settings.cityBonus = old.recipe.cityBonus !== undefined ? old.recipe.cityBonus : true;
        s.settings.focus = !!old.recipe.focus;
        s.settings.bonusDay = old.recipe.bonusDay || 'none';
        s.settings.stationFee = old.recipe.stationFee || 0;
      }
      if(old.sell){
        s.settings.saleType = old.sell.type === 'order' ? 'order' : 'quick';
        s.settings.premium = old.sell.premium !== undefined ? old.sell.premium : true;
        s.settings.setupFeeRate = old.sell.setupFeeRate !== undefined ? old.sell.setupFeeRate : 2.5;
        if(old.selectedItemId && old.sell.price){
          s.sellPrices[sellKey(old.selectedItemId, s.settings.tier, s.settings.ench)] = old.sell.price;
        }
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
function getSellPrice(itemId){
  const s = STATE.settings;
  return Number(STATE.sellPrices[sellKey(itemId, s.tier, s.ench)] || 0);
}
function setSellPrice(itemId, val){
  const s = STATE.settings;
  STATE.sellPrices[sellKey(itemId, s.tier, s.ench)] = val;
  saveState();
}

/* Resource Return Rate formula, based on published Albion Online mechanics
   (wiki.albiononline.com/wiki/Resource_return_rate + albiononlinehub.com/craft-planner):
     - base city crafting production bonus:      +18%   -> RRR 15.25%
     - specialty (bonus-city) crafting bonus:     +15%   -> total 33%  -> RRR 24.81%
     - Focus usage:                               +59% flat
     - Daily bonus (2 items/day get extra):       +10% (silver) or +20% (gold)
   RRR = 1 - 1/(1 + totalBonus/100)
--------------------------------------------------------------------- */
function calcRRR(opts){
  let bonus = 18; // always present at a city crafting station
  if(opts.cityBonus) bonus += 15;
  if(opts.focus) bonus += 59;
  if(opts.bonusDay === 'silver') bonus += 10;
  if(opts.bonusDay === 'gold') bonus += 20;
  const rrr = 1 - 1/(1 + bonus/100);
  return {rrr, bonus};
}

function computeItemCost(item){
  const s = STATE.settings;
  const {rrr, bonus} = calcRRR(s);
  const m = item.materials || {plank:0,steel:0,leather:0,cloth:0,artifact:0};

  const breakdown = MATERIALS.map(mat=>{
    const rawQty = Number(m[mat.id])||0;
    const unitPrice = getPrice(mat.id, s.tier, s.ench);
    const effectiveQty = rawQty * (1 - rrr);
    const cost = effectiveQty * unitPrice;
    return {id:mat.id, label:mat.label, rawQty, unitPrice, effectiveQty, cost};
  }).filter(b=>b.rawQty>0);

  const materialCost = breakdown.reduce((sum,b)=>sum+b.cost, 0);
  const artifactQty = Number(m.artifact)||0;
  const artifactCost = artifactQty * getArtifactPrice(s.tier);
  const stationFee = Number(s.stationFee)||0;
  const total = materialCost + artifactCost + stationFee;

  return {breakdown, rrr, bonus, materialCost, artifactQty, artifactCost, stationFee, total};
}

function computeNetSell(sellPrice){
  const s = STATE.settings;
  const taxRate = s.premium ? 4 : 8;
  const setupRate = s.saleType === 'order' ? Number(s.setupFeeRate)||0 : 0;
  const setupFee = sellPrice * (setupRate/100);
  const tax = sellPrice * (taxRate/100);
  const net = sellPrice - setupFee - tax;
  return {taxRate, setupRate, setupFee, tax, net};
}

function computeProfit(item){
  const cost = computeItemCost(item);
  const sellPrice = getSellPrice(item.id);
  const {net, tax, setupFee, taxRate} = computeNetSell(sellPrice);
  const profit = net - cost.total;
  const margin = sellPrice>0 ? (profit/sellPrice*100) : 0;
  return {cost, sellPrice, net, tax, setupFee, taxRate, profit, margin};
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
    if(page==='sell') renderSellPricePage();
    if(page==='profit') renderProfitPage();
    if(page==='build') renderBuildPage();
  });
});

document.querySelectorAll('.subtabbtn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.subtabbtn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('sub-refined').style.display = btn.dataset.sub==='refined' ? '' : 'none';
    document.getElementById('sub-artifact').style.display = btn.dataset.sub==='artifact' ? '' : 'none';
  });
});

document.getElementById('resetBtn').addEventListener('click', ()=>{
  if(confirm('すべての価格・設定をリセットしますか？')){
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(LS_KEY_OLD);
    STATE = defaultState();
    buildRefinedGrid();
    buildArtifactGrid();
    renderAllPickerPages();
    updateTopProfit();
  }
});

/* =======================================================================
   PAGE 1: 原価入力 — Refined material price grid
======================================================================= */
function buildRefinedGrid(){
  const wrap = document.getElementById('refinedGrid');
  wrap.innerHTML = '';
  MATERIALS.forEach(mat=>{
    const col = document.createElement('div');
    col.className = 'pricecol';
    let html = `<h5>${mat.label}</h5>`;

    [1,2,3].forEach(t=>{
      html += rowHtml(mat.id, t, 0, `T${t}`);
    });
    TIERS4to8.forEach(t=>{
      ENCH.forEach(e=>{
        html += rowHtml(mat.id, t, e, `T${t}.${e}`);
      });
    });
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
   共通設定バー（ティア・エンチャント・還元率・売却手数料）
   売値 / 利益率 / 作成リスト の3ページで共有する
======================================================================= */
function renderSettingsBar(container, opts){
  opts = opts || {};
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
        ${opts.full ? `
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
          <span class="mtlabel">ボーナスシティ</span>
        </label>
        <label class="minitoggle">
          <input type="checkbox" id="stFocus" ${s.focus?'checked':''}>
          <span class="slider"></span>
          <span class="mtlabel">フォーカス使用</span>
        </label>
        <div class="field" style="max-width:170px;">
          <label>ボーナスデー</label>
          <select id="stBonusDay">
            <option value="none" ${s.bonusDay==='none'?'selected':''}>なし</option>
            <option value="silver" ${s.bonusDay==='silver'?'selected':''}>シルバーデー +10%</option>
            <option value="gold" ${s.bonusDay==='gold'?'selected':''}>ゴールドデー +20%</option>
          </select>
        </div>
        <div class="pill" style="margin-left:auto;">還元率 <b id="stRRR">${(calcRRR(s).rrr*100).toFixed(2)}%</b></div>
        ` : `<div class="note" style="flex:1;margin:0;">この設定（ティア・補正段階）は他タブと共通です。原価・利益の計算にはさらに「利益率」タブの還元率・手数料設定も使われます。</div>`}
      </div>
    </div>
  `;

  document.getElementById('stTier').addEventListener('change', e=>{ s.tier=Number(e.target.value); saveState(); opts.onChange(); updateTopProfit(); });
  document.getElementById('stEnch').addEventListener('change', e=>{ s.ench=Number(e.target.value); saveState(); opts.onChange(); updateTopProfit(); });

  if(opts.full){
    document.getElementById('stStationFee').addEventListener('input', e=>{ s.stationFee=Number(e.target.value)||0; saveState(); opts.onChange(); updateTopProfit(); });
    document.getElementById('stSaleType').addEventListener('change', e=>{ s.saleType=e.target.value; saveState(); opts.onChange(); updateTopProfit(); });
    document.getElementById('stSetupFeeRate').addEventListener('input', e=>{ s.setupFeeRate=Number(e.target.value)||0; saveState(); opts.onChange(); updateTopProfit(); });
    document.getElementById('stPremium').addEventListener('change', e=>{ s.premium=e.target.checked; saveState(); opts.onChange(); updateTopProfit(); });
    document.getElementById('stCityBonus').addEventListener('change', e=>{ s.cityBonus=e.target.checked; saveState(); opts.onChange(); updateTopProfit(); });
    document.getElementById('stFocus').addEventListener('change', e=>{ s.focus=e.target.checked; saveState(); opts.onChange(); updateTopProfit(); });
    document.getElementById('stBonusDay').addEventListener('change', e=>{ s.bonusDay=e.target.value; saveState(); opts.onChange(); updateTopProfit(); });
  }
}

/* =======================================================================
   グループ化されたアイテムピッカー（種類ごとに折りたたみ）
   売値 / 利益率 / 作成リスト の3ページで共有するビルダー
======================================================================= */
const pickerUIState = {
  activeCategory: {sell:'head', profit:'head', build:'head'},
  searchTerm: {sell:'', profit:'', build:''},
  expandedGroups: {sell:new Set(), profit:new Set(), build:new Set()},
};

function groupKey(pageId, category, sub){
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

/**
 * pageId: 'sell' | 'profit' | 'build'
 * renderRow(item): returns an HTMLElement for that item's row/card content (page-specific)
 */
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

  const groupCat = term ? null : cat; // 検索時はカテゴリ問わずフラット表示
  const groups = term
    ? [{sub:null, label:'検索結果', items:list}]
    : buildGroups(cat, list);
  const forceOpen = !!term;

  const toolbar = document.createElement('div');
  toolbar.className = 'grouptoolbar';
  toolbar.innerHTML = `<button type="button" class="tinybtn" data-act="expand">すべて展開</button><button type="button" class="tinybtn" data-act="collapse">すべて折りたたむ</button>`;
  wrap.appendChild(toolbar);
  toolbar.querySelector('[data-act=expand]').addEventListener('click', ()=>{
    groups.forEach(g=>expanded.add(groupKey(pageId, cat, g.sub)));
    renderItemPicker(pageId, wrap, renderRow);
  });
  toolbar.querySelector('[data-act=collapse]').addEventListener('click', ()=>{
    groups.forEach(g=>expanded.delete(groupKey(pageId, cat, g.sub)));
    renderItemPicker(pageId, wrap, renderRow);
  });

  groups.forEach(g=>{
    const key = groupKey(pageId, cat, g.sub);
    const isOpen = forceOpen || expanded.has(key);
    const label = g.label===null ? (CATS.find(c=>c.id===cat)||{}).label : g.label;
    const repImg = g.items[0].file; // 代表画像（元データ順で先頭のアイテム）

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
   PAGE 2: 売値 — 全アイテムの売値を一括入力
======================================================================= */
function renderSellPricePage(){
  renderSettingsBar(document.getElementById('sellSettingsBar'), {full:false, onChange: renderSellPricePage});
  renderCategorySidebar('sell', document.getElementById('sellCategoryList'), renderSellPricePage);

  const search = document.getElementById('sellSearch');
  search.value = pickerUIState.searchTerm.sell;
  search.oninput = (e)=>{ pickerUIState.searchTerm.sell = e.target.value.trim().toLowerCase(); renderSellPricePage(); };

  renderItemPicker('sell', document.getElementById('sellItemList'), (item)=>{
    const row = document.createElement('div');
    row.className = 'itemrow';
    row.innerHTML = `
      <img src="${item.file}" alt="${item.name}">
      <div class="irname">${item.name}${isArtifactItem(item)?'<span class="tag-artifact">Artifact</span>':''}</div>
      <div class="irfield">
        <input type="number" min="0" placeholder="売値 silver" value="${getSellPrice(item.id)||''}">
      </div>
    `;
    row.querySelector('input').addEventListener('input', e=>{
      setSellPrice(item.id, Number(e.target.value)||0);
      updateTopProfit();
    });
    return row;
  });
}

/* =======================================================================
   PAGE 3: 利益率 — 各アイテムの原価・利益・利益率一覧
======================================================================= */
function renderProfitPage(){
  renderSettingsBar(document.getElementById('profitSettingsBar'), {full:true, onChange: renderProfitPage});
  renderCategorySidebar('profit', document.getElementById('profitCategoryList'), renderProfitPage);

  const search = document.getElementById('profitSearch');
  search.value = pickerUIState.searchTerm.profit;
  search.oninput = (e)=>{ pickerUIState.searchTerm.profit = e.target.value.trim().toLowerCase(); renderProfitPage(); };

  renderItemPicker('profit', document.getElementById('profitItemList'), (item)=>{
    const p = computeProfit(item);
    const row = document.createElement('div');
    row.className = 'itemrow itemrow-profit';
    row.innerHTML = `
      <img src="${item.file}" alt="${item.name}">
      <div class="irname">${item.name}${isArtifactItem(item)?'<span class="tag-artifact">Artifact</span>':''}</div>
      <div class="irstat"><span class="irk">原価</span><span class="irv">${fmt(p.cost.total)}</span></div>
      <div class="irstat"><span class="irk">売値</span><span class="irv">${fmt(p.sellPrice)}</span></div>
      <div class="irstat"><span class="irk">利益</span><span class="irv ${p.profit>=0?'profit-pos':'profit-neg'}">${p.profit>=0?'+':''}${fmt(p.profit)}</span></div>
      <div class="irstat"><span class="irk">利益率</span><span class="irv ${p.margin>=0?'profit-pos':'profit-neg'}">${p.sellPrice>0 ? p.margin.toFixed(1)+'%' : '—'}</span></div>
    `;
    return row;
  });
}

/* =======================================================================
   PAGE 4: 作成リスト — 作るアイテムを選んで追加、必要素材を集計
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
  renderSettingsBar(document.getElementById('buildSettingsBar'), {full:true, onChange: renderBuildPage});
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
  const entries = Object.keys(STATE.craftList)
    .map(id=>({item: ITEMS.find(i=>i.id===id), qty: STATE.craftList[id]}))
    .filter(e=>e.item && e.qty>0);

  if(entries.length===0){
    wrap.innerHTML = `<div class="empty-hint">右のリストから装備を選んで「追加」すると、ここに必要な素材がまとまります</div>`;
    return;
  }

  const totals = {plank:0, steel:0, leather:0, cloth:0, artifact:0};
  let grandTotal = 0;

  const rows = entries.map(({item, qty})=>{
    const cost = computeItemCost(item);
    grandTotal += cost.total * qty;
    const m = item.materials;
    MATERIALS.forEach(mat=>{ totals[mat.id] += (Number(m[mat.id])||0) * qty; });
    totals.artifact += (Number(m.artifact)||0) * qty;

    return `
      <div class="craftrow">
        <img src="${item.file}" alt="${item.name}">
        <div class="irname">${item.name}</div>
        <input type="number" min="0" class="craftqty" data-id="${item.id}" value="${qty}">
        <div class="craftcost">${fmt(cost.total*qty)}</div>
        <button type="button" class="tinybtn removebtn" data-id="${item.id}">削除</button>
      </div>`;
  }).join('');

  const {rrr} = calcRRR(STATE.settings);
  const matRows = MATERIALS.map(mat=>{
    const raw = totals[mat.id];
    if(raw<=0) return '';
    const eff = raw * (1-rrr);
    return `<div class="srow"><span class="k">${mat.label}</span><span class="v">${fmt(raw)}（還元後 ${eff.toFixed(1)}）</span></div>`;
  }).join('');
  const artRow = totals.artifact>0
    ? `<div class="srow"><span class="k">アーティファクト欠片</span><span class="v">${fmt(totals.artifact)} 個</span></div>`
    : '';

  wrap.innerHTML = `
    <div class="card">
      <h3>作成リスト（${entries.length}種）</h3>
      <div class="craftrows">${rows}</div>
    </div>
    <div class="card summary-box">
      <div class="summary-title">必要素材の合計</div>
      ${matRows || `<div class="srow"><span class="k">素材データなし</span></div>`}
      ${artRow}
      <div class="srow total"><span class="k">合計クラフト原価</span><span class="v">${fmt(grandTotal)}</span></div>
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
   共通：トップバーの概算利益表示（作成リスト合計の利益）
======================================================================= */
function updateTopProfit(){
  const el = document.getElementById('topProfit');
  const entries = Object.keys(STATE.craftList)
    .map(id=>({item: ITEMS.find(i=>i.id===id), qty: STATE.craftList[id]}))
    .filter(e=>e.item && e.qty>0);

  if(entries.length===0){ el.textContent='—'; return; }

  let totalProfit = 0, any = false;
  entries.forEach(({item, qty})=>{
    const p = computeProfit(item);
    if(p.sellPrice>0){ totalProfit += p.profit*qty; any = true; }
  });
  if(!any){ el.textContent='—'; return; }
  el.textContent = (totalProfit>=0?'+':'') + fmt(totalProfit) + ' silver';
  el.style.color = totalProfit>=0 ? 'var(--green)' : 'var(--red)';
}

/* =======================================================================
   Init
======================================================================= */
function renderAllPickerPages(){
  renderSellPricePage();
  renderProfitPage();
  renderBuildPage();
}

buildRefinedGrid();
buildArtifactGrid();
renderAllPickerPages();
updateTopProfit();
