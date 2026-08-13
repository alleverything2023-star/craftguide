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

/* ---------------------------------------------------------------------
   Persistent state (localStorage)
--------------------------------------------------------------------- */
const LS_KEY = 'albion_calc_state_v1';

function loadState(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return {
    prices:{},        // e.g. prices["plank_T4_1"] = 1234
    artifactPrices:{},// artifactPrices["T6"] = 5000
    selectedItemId:null,
    recipe:{
      tier:4, ench:0, qty:20, material:null,
      useArtifact:false,
      cityBonus:true, focus:false, bonusDay:'none', // none/silver/gold
      stationFee:0
    },
    sell:{
      type:'quick', price:0, premium:true, setupFeeRate:2.5
    }
  };
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
    if(page==='sell') renderSellPage();
    if(page==='calc') renderRecipePanel();
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
    STATE = loadState();
    buildRefinedGrid();
    buildArtifactGrid();
    renderCategories();
    renderItemGrid();
    renderRecipePanel();
    renderSellPage();
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

    // T1 - T3 (no enchant)
    [1,2,3].forEach(t=>{
      html += rowHtml(mat.id, t, 0, `T${t}`);
    });

    // T4 - T8, ench 0-4
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
      renderRecipePanel();
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
      renderRecipePanel();
      updateTopProfit();
    });
  });
}

/* =======================================================================
   PAGE 2: 計算 — Item picker + recipe / cost panel
======================================================================= */
let activeCategory = 'head';
let searchTerm = '';

function renderCategories(){
  const wrap = document.getElementById('categoryList');
  wrap.innerHTML = '';
  CATS.forEach(c=>{
    const count = ITEMS.filter(i=>i.category===c.id).length;
    const btn = document.createElement('button');
    btn.className = 'catbtn' + (c.id===activeCategory ? ' active':'');
    btn.innerHTML = `<span class="ic">${c.ic}</span>${c.label}<span class="catcount">${count}</span>`;
    btn.addEventListener('click', ()=>{
      activeCategory = c.id;
      renderCategories();
      renderItemGrid();
    });
    wrap.appendChild(btn);
  });
}

document.getElementById('itemSearch').addEventListener('input', (e)=>{
  searchTerm = e.target.value.trim().toLowerCase();
  renderItemGrid();
});

function renderItemGrid(){
  const wrap = document.getElementById('itemGrid');
  wrap.innerHTML = '';
  let list = ITEMS.filter(i=>i.category===activeCategory);
  if(searchTerm){
    list = ITEMS.filter(i=>i.name.toLowerCase().includes(searchTerm));
  }
  if(list.length===0){
    wrap.innerHTML = `<div class="empty-hint" style="grid-column:1/-1;">該当する装備が見つかりません</div>`;
    return;
  }
  list.forEach(item=>{
    const card = document.createElement('div');
    card.className = 'itemcard' + (item.id===STATE.selectedItemId ? ' selected':'');
    card.innerHTML = `<img src="${item.file}" loading="lazy" alt="${item.name}">
      <div class="nm">${item.name}</div>
      ${item.artifact ? '<span class="tag-artifact">Artifact</span>' : ''}`;
    card.addEventListener('click', ()=>selectItem(item.id));
    wrap.appendChild(card);
  });
}

function selectItem(itemId){
  const item = ITEMS.find(i=>i.id===itemId);
  if(!item) return;
  STATE.selectedItemId = itemId;
  STATE.recipe.material = item.material;
  STATE.recipe.qty = item.qty;
  STATE.recipe.useArtifact = item.artifact;
  saveState();
  renderItemGrid();
  renderRecipePanel();
  updateTopProfit();
}

function currentItem(){
  return ITEMS.find(i=>i.id===STATE.selectedItemId) || null;
}

function renderRecipePanel(){
  const wrap = document.getElementById('recipePanelWrap');
  const item = currentItem();
  if(!item){
    wrap.innerHTML = `<div class="empty-hint">上のリストから装備を選択してください</div>`;
    return;
  }
  const r = STATE.recipe;

  wrap.innerHTML = `
    <div class="grid2">
      <div>
        <div class="card">
          <div class="selected-item-header">
            <img src="${item.file}" alt="${item.name}">
            <div class="info">
              <b>${item.name}</b>
              <div class="meta">${CATS.find(c=>c.id===item.category).label} ${item.artifact ? '<span class="badge">アーティファクト装備</span>':''}</div>
            </div>
          </div>

          <div class="row">
            <div class="field">
              <label>ティア</label>
              <select id="rTier">
                ${TIERS4to8.map(t=>`<option value="${t}" ${t==r.tier?'selected':''}>T${t}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>補正段階（エンチャント）</label>
              <select id="rEnch">
                ${ENCH.map(e=>`<option value="${e}" ${e==r.ench?'selected':''}>.${e}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="row">
            <div class="field">
              <label>使用素材</label>
              <select id="rMaterial">
                ${MATERIALS.map(m=>`<option value="${m.id}" ${m.id===r.material?'selected':''}>${m.label}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>必要個数（編集可）</label>
              <input type="number" id="rQty" min="0" value="${r.qty}">
            </div>
          </div>

          <div class="togglecard">
            <div><div class="tt">アーティファクト装備として計算</div><div class="dd">専門化装備はアーティファクト欠片1個が必要</div></div>
            <label class="switch"><input type="checkbox" id="rArtifact" ${r.useArtifact?'checked':''}><span class="slider"></span></label>
          </div>

          <div class="field">
            <label>ステーション使用料（1回あたり / silver・任意）</label>
            <input type="number" id="rStationFee" min="0" value="${r.stationFee||0}">
          </div>
        </div>

        <div class="card">
          <h3>製作条件（Resource Return Rate）</h3>
          <div class="sub">albiononlinehub.com/craft-planner の仕様を参考にした素材還元率の計算です</div>

          <div class="togglecard">
            <div><div class="tt">ボーナスシティで製作</div><div class="dd">専門化都市：還元率 15.25% → 24.81%</div></div>
            <label class="switch"><input type="checkbox" id="rCityBonus" ${r.cityBonus?'checked':''}><span class="slider"></span></label>
          </div>

          <div class="togglecard">
            <div><div class="tt">フォーカスを使用</div><div class="dd">還元率に+59%（大幅に還元率アップ）</div></div>
            <label class="switch"><input type="checkbox" id="rFocus" ${r.focus?'checked':''}><span class="slider"></span></label>
          </div>

          <div class="field">
            <label>ボーナスデー</label>
            <div class="seg" id="rBonusDaySeg">
              <button data-v="none" class="${r.bonusDay==='none'?'active':''}">なし</button>
              <button data-v="silver" class="${r.bonusDay==='silver'?'active':''}">シルバーデー +10%</button>
              <button data-v="gold" class="${r.bonusDay==='gold'?'active':''}">ゴールドデー +20%</button>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div class="card summary-box" id="calcSummaryCard"></div>
      </div>
    </div>
  `;

  // bind events
  document.getElementById('rTier').addEventListener('change', e=>{ r.tier=Number(e.target.value); saveState(); renderRecipePanel(); });
  document.getElementById('rEnch').addEventListener('change', e=>{ r.ench=Number(e.target.value); saveState(); renderRecipePanel(); });
  document.getElementById('rMaterial').addEventListener('change', e=>{ r.material=e.target.value; saveState(); renderRecipePanel(); });
  document.getElementById('rQty').addEventListener('input', e=>{ r.qty=Number(e.target.value)||0; saveState(); renderCalcSummary(); updateTopProfit(); });
  document.getElementById('rArtifact').addEventListener('change', e=>{ r.useArtifact=e.target.checked; saveState(); renderCalcSummary(); updateTopProfit(); });
  document.getElementById('rStationFee').addEventListener('input', e=>{ r.stationFee=Number(e.target.value)||0; saveState(); renderCalcSummary(); updateTopProfit(); });
  document.getElementById('rCityBonus').addEventListener('change', e=>{ r.cityBonus=e.target.checked; saveState(); renderCalcSummary(); updateTopProfit(); });
  document.getElementById('rFocus').addEventListener('change', e=>{ r.focus=e.target.checked; saveState(); renderCalcSummary(); updateTopProfit(); });
  document.querySelectorAll('#rBonusDaySeg button').forEach(b=>{
    b.addEventListener('click', ()=>{
      r.bonusDay = b.dataset.v;
      saveState();
      renderRecipePanel();
    });
  });

  renderCalcSummary();
}

function computeCraftCost(){
  const item = currentItem();
  const r = STATE.recipe;
  if(!item) return null;

  const unitPrice = getPrice(r.material, r.tier, r.ench);
  const {rrr, bonus} = calcRRR(r);
  const effectiveQty = r.qty * (1 - rrr);
  const materialCost = effectiveQty * unitPrice;
  const artifactCost = r.useArtifact ? getArtifactPrice(r.tier) : 0;
  const stationFee = Number(r.stationFee)||0;
  const total = materialCost + artifactCost + stationFee;

  return {
    unitPrice, rrr, bonus, effectiveQty, materialCost, artifactCost, stationFee, total,
    rawQty: r.qty
  };
}

function renderCalcSummary(){
  const card = document.getElementById('calcSummaryCard');
  if(!card) return;
  const c = computeCraftCost();
  if(!c){ card.innerHTML=''; return; }

  card.innerHTML = `
    <div class="summary-title">クラフト原価サマリー</div>
    <div class="srow"><span class="k">還元率 (RRR)</span><span class="v">${(c.rrr*100).toFixed(2)}%</span></div>
    <div class="srow"><span class="k">必要素材（消費前）</span><span class="v">${fmt(c.rawQty)} 個</span></div>
    <div class="srow"><span class="k">実質消費量（還元後）</span><span class="v">${c.effectiveQty.toFixed(2)} 個</span></div>
    <div class="srow"><span class="k">素材単価</span><span class="v">${fmt(c.unitPrice)}</span></div>
    <div class="srow"><span class="k">素材コスト</span><span class="v">${fmt(c.materialCost)}</span></div>
    <div class="srow"><span class="k">アーティファクト代</span><span class="v">${fmt(c.artifactCost)}</span></div>
    <div class="srow"><span class="k">ステーション使用料</span><span class="v">${fmt(c.stationFee)}</span></div>
    <div class="srow total"><span class="k">クラフト原価合計</span><span class="v">${fmt(c.total)}</span></div>
    <div class="helpbox">この原価は「売値」タブに自動で反映され、利益・利益率が計算されます。</div>
  `;
}

/* =======================================================================
   PAGE 3: 売値 — Sell price & profit margin
======================================================================= */
document.querySelectorAll('#sellTypeSeg button').forEach(b=>{
  b.addEventListener('click', ()=>{
    STATE.sell.type = b.dataset.v;
    saveState();
    renderSellPage();
  });
});
document.getElementById('sellPrice').addEventListener('input', e=>{
  STATE.sell.price = Number(e.target.value)||0;
  saveState();
  renderSellPage();
});
document.getElementById('sellPremium').addEventListener('change', e=>{
  STATE.sell.premium = e.target.checked;
  saveState();
  renderSellPage();
});
document.getElementById('setupFeeRate').addEventListener('input', e=>{
  STATE.sell.setupFeeRate = Number(e.target.value)||0;
  saveState();
  renderSellPage();
});

function renderSellPage(){
  const item = currentItem();
  const header = document.getElementById('sellSelectedHeader');
  if(item){
    header.innerHTML = `<div class="card" style="padding:14px 20px;">
      <div class="selected-item-header" style="margin:0;">
        <img src="${item.file}" alt="${item.name}">
        <div class="info"><b>${item.name}</b><div class="meta">T${STATE.recipe.tier}.${STATE.recipe.ench} ・ ${CATS.find(c=>c.id===item.category).label}</div></div>
      </div>
    </div>`;
  } else {
    header.innerHTML = `<div class="empty-hint">「計算」タブで装備を選択すると、ここに表示されます</div>`;
  }

  // sync form values
  document.getElementById('sellPrice').value = STATE.sell.price || '';
  document.getElementById('sellPremium').checked = STATE.sell.premium;
  document.getElementById('setupFeeRate').value = STATE.sell.setupFeeRate;
  document.querySelectorAll('#sellTypeSeg button').forEach(b=>{
    b.classList.toggle('active', b.dataset.v === STATE.sell.type);
  });

  const sellPrice = Number(STATE.sell.price)||0;
  const taxRate = STATE.sell.premium ? 4 : 8;
  const setupRate = STATE.sell.type === 'order' ? Number(STATE.sell.setupFeeRate)||0 : 0;

  const setupFee = sellPrice * (setupRate/100);
  const tax = sellPrice * (taxRate/100);
  const net = sellPrice - setupFee - tax;

  const craft = computeCraftCost();
  const cost = craft ? craft.total : 0;
  const profit = net - cost;
  const margin = sellPrice>0 ? (profit/sellPrice*100) : 0;

  document.getElementById('sv_sellprice').textContent = fmt(sellPrice);
  document.getElementById('sv_setupfee').textContent = '-' + fmt(setupFee);
  document.getElementById('sv_taxrate').textContent = taxRate;
  document.getElementById('sv_tax').textContent = '-' + fmt(tax);
  document.getElementById('sv_net').textContent = fmt(net);
  document.getElementById('sv_cost').textContent = fmt(cost);

  const profitEl = document.getElementById('sv_profit');
  profitEl.textContent = (profit>=0?'+':'') + fmt(profit);
  profitEl.className = 'v ' + (profit>=0 ? 'profit-pos':'profit-neg');

  const marginEl = document.getElementById('sv_margin');
  marginEl.textContent = margin.toFixed(1) + '%';
  marginEl.className = 'v ' + (margin>=0 ? 'profit-pos':'profit-neg');

  document.getElementById('sellHint').textContent = craft
    ? `原価内訳：素材 ${fmt(craft.materialCost)} + アーティファクト ${fmt(craft.artifactCost)} + 手数料 ${fmt(craft.stationFee)}（還元率 ${(craft.rrr*100).toFixed(2)}%適用済み）`
    : '※ 計算タブで装備を選択すると原価が反映されます。';

  updateTopProfit();
}

function updateTopProfit(){
  const el = document.getElementById('topProfit');
  const craft = computeCraftCost();
  const sellPrice = Number(STATE.sell.price)||0;
  if(!craft || sellPrice<=0){ el.textContent='—'; return; }
  const taxRate = STATE.sell.premium ? 4 : 8;
  const setupRate = STATE.sell.type === 'order' ? Number(STATE.sell.setupFeeRate)||0 : 0;
  const net = sellPrice - sellPrice*(setupRate/100) - sellPrice*(taxRate/100);
  const profit = net - craft.total;
  el.textContent = (profit>=0?'+':'') + fmt(profit) + ' silver';
  el.style.color = profit>=0 ? 'var(--green)' : 'var(--red)';
}

/* =======================================================================
   Init
======================================================================= */
buildRefinedGrid();
buildArtifactGrid();
renderCategories();
renderItemGrid();
renderRecipePanel();
renderSellPage();
updateTopProfit();
