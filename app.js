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

// 未加工素材（精錬前の原材料）。精製素材1個を作るのに必要な原材料の換算に使う（Step④）
const RAW_MATERIALS = [
  {id:'raw_plank',   label:'原木 (Wood)',  refines:'plank'},
  {id:'raw_steel',   label:'鉱石 (Ore)',   refines:'steel'},
  {id:'raw_leather', label:'原皮 (Hide)',  refines:'leather'},
  {id:'raw_cloth',   label:'繊維 (Fiber)', refines:'cloth'},
];

// 精錬時の原材料必要数（ユーザー提示の固定値）。
// T4: Raw2+下位(T3)精製素材1 / T5: Raw3+T4×1 / T6: Raw4+T5×1 / T7: Raw5+T6×1 / T8: Raw6+T7×1
const REFINE_RECIPE = {
  4: { raw:2, lowerTier:3, lowerQty:1 },
  5: { raw:3, lowerTier:4, lowerQty:1 },
  6: { raw:4, lowerTier:5, lowerQty:1 },
  7: { raw:5, lowerTier:6, lowerQty:1 },
  8: { raw:6, lowerTier:7, lowerQty:1 },
};

// AODP (Albion Online Data Project) のアイテムID。精製素材・原材料は
// "T{tier}_{RESOURCE}"（エンチャントは末尾に @1〜@4）という確立された命名規則があるため自動生成できる。
// 個別の装備（Set名やアーティファクト接尾辞がバラバラ）は自動生成せず、手動で対応表に登録する（Step⑤）。
const MATERIAL_AODP_BASE = { plank:'PLANKS', steel:'METALBAR', leather:'LEATHER', cloth:'CLOTH' };
const RAW_AODP_BASE = { raw_plank:'WOOD', raw_steel:'ORE', raw_leather:'HIDE', raw_cloth:'FIBER' };
function materialAodpId(materialId, tier, ench){
  const base = MATERIAL_AODP_BASE[materialId] || RAW_AODP_BASE[materialId];
  if(!base) return null;
  return `T${tier}_${base}` + (ench>0 ? `@${ench}` : '');
}

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
   ロイヤル都市とボーナス都市（精錬・製作）のマッピング
   ユーザー提示のマスターデータに準拠。
--------------------------------------------------------------------- */
const CITIES = ['Martlock', 'Thetford', 'FortSterling', 'Lymhurst', 'Bridgewatch', 'Caerleon'];
const CITY_LABELS_JA = {
  Martlock:'マートロック', Thetford:'セットフォード', FortSterling:'フォートスターリング',
  Lymhurst:'リムハースト', Bridgewatch:'ブリッジウォッチ', Caerleon:'カエルレオン',
};

// 精錬ボーナス都市（素材id: MATERIALSのidに対応）
const REFINE_BONUS_CITY = {
  steel:   'Thetford',      // 金属インゴット
  cloth:   'Lymhurst',      // 布
  leather: 'Martlock',      // 革
  plank:   'FortSterling',  // 木材
  // stone（石材）は現状 MATERIALS に無いため未使用。追加時は 'Bridgewatch' を割り当てる。
};

// 製作ボーナス都市。防具は「素材種::カテゴリ」、武器/オフハンドは「武器種(subtype)」で判定する
// （plate/leather/clothはhead/chest/footで異なる都市になるため）。
const CRAFT_BONUS_CITY = {
  // クロス防具
  'cloth::head':  'Thetford',      // Cowl
  'cloth::chest': 'FortSterling',  // Robe
  'cloth::foot':  'Bridgewatch',   // Sandals
  // レザー防具
  'leather::head':  'Lymhurst',    // Hood
  'leather::chest': 'Thetford',    // Jacket
  'leather::foot':  'Lymhurst',    // Shoes
  // プレート防具
  'plate::head':  'FortSterling',
  'plate::chest': 'Bridgewatch',
  'plate::foot':  'Martlock',      // Boots
  // 武器
  hammer:'FortSterling', mace:'Thetford', axe:'Martlock', sword:'Lymhurst',
  crossbow:'Bridgewatch', bow:'Lymhurst', dagger:'Bridgewatch', spear:'FortSterling',
  quarterstaff:'Martlock', firestaff:'Thetford', naturestaff:'Thetford',
  arcanestaff:'Lymhurst', holystaff:'FortSterling', froststaff:'Martlock',
  cursedstaff:'Bridgewatch', shapeshifterstaff:'Caerleon',
  fist:'Caerleon', // War Gloves
  // オフハンド（book/torch/shield。horn相当は現データに無し）
  shield:'Martlock', torch:'Martlock', tome:'Martlock',
  // cape: マスターデータに記載無し（ボーナス都市なし）
};

// アイテムのボーナス都市を解決する。防具はhead/chest/footでplate/leather/clothの都市が異なるため
// "subtype::category" で引き、武器・オフハンドは subtype 単体で引く。該当なし（cape等）は null。
function getBonusCity(item){
  if(['head','chest','foot'].includes(item.category)){
    return CRAFT_BONUS_CITY[`${item.subtype}::${item.category}`] || null;
  }
  return CRAFT_BONUS_CITY[item.subtype] || null;
}

/* ---------------------------------------------------------------------
   Persistent state (localStorage)
--------------------------------------------------------------------- */
const LS_KEY = 'albion_calc_state_v12';

function defaultSettings(){
  return {
    tier:4, ench:0,               // 作成リストで実際に作るティア・補正段階
    craftingCity:'Martlock',      // どの都市のステーションでクラフトするか（ボーナス都市判定に使用）
    buyingCity:'Martlock',        // 素材・アーティファクトをどの都市で買うか（原価計算に使用）
    sellingCity:'Caerleon',       // どの都市で売るか（売値の参照・利益計算に使用）
    focus:false,                  // フォーカス使用（還元率+59%）
    saleType:'quick', premium:true,
  };
}

function defaultState(){
  return {
    prices:{},          // prices["plank_T4_1"] = 1234 （都市未指定時のフォールバック価格）
    artifactPrices:{},  // artifactPrices["itemId_T6"] = 5000 （同上フォールバック）
    sellPrices:{},      // sellPrices["itemId_T4_0"] = 45000 （同上フォールバック）
    cityPrices:{},         // cityPrices["Thetford:plank_T4_1"] = 1234 （都市別の素材価格）
    cityArtifactPrices:{},// cityArtifactPrices["Thetford:itemId_T6"] = 5000 （都市別のアーティファクト価格）
    citySellPrices:{},     // citySellPrices["Caerleon:itemId_T4_0"] = 45000 （都市別の売値）
    inventory:{},           // inventory["Martlock:plank_T4_1"] = 320 （都市の倉庫にある素材の在庫数）
    aodpMapping:{},          // aodpMapping["itemId"] = "T4_HEAD_PLATE_SET1" （AODPのアイテムID。装備ごとに手動登録）
    bonusSubtypes:{},    // bonusSubtypes["weapon::sword"] = 10 | 20 （その日の日替わり生産ボーナスは"武器種"単位で付与される）
    stationFeeBase:0,   // ステーション使用料：T4.0時点の基準額。ティア+エンチャントの合計が1上がるごとに倍になる
    settings: defaultSettings(),
    craftList:{},        // craftList["itemId_T{tier}_{ench}"] = {itemId,tier,ench,qty}
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(raw) return Object.assign(defaultState(), JSON.parse(raw));
  }catch(e){}

  // v11（在庫管理は導入済みだが、AODP連携が無かったバージョン）からの移行
  try{
    const oldRaw = localStorage.getItem('albion_calc_state_v11');
    if(oldRaw){
      const old = JSON.parse(oldRaw);
      const s = defaultState();
      s.prices = old.prices || {};
      s.artifactPrices = old.artifactPrices || {};
      s.sellPrices = old.sellPrices || {};
      s.cityPrices = old.cityPrices || {};
      s.cityArtifactPrices = old.cityArtifactPrices || {};
      s.citySellPrices = old.citySellPrices || {};
      s.inventory = old.inventory || {};
      s.bonusSubtypes = old.bonusSubtypes || {};
      s.craftList = old.craftList || {};
      s.stationFeeBase = old.stationFeeBase || 0;
      if(old.settings) Object.assign(s.settings, old.settings);
      return s;
    }
  }catch(e){}

  // v10（都市別価格マトリクスは導入済みだが、在庫管理が無かったバージョン）からの移行
  try{
    const oldRaw = localStorage.getItem('albion_calc_state_v10');
    if(oldRaw){
      const old = JSON.parse(oldRaw);
      const s = defaultState();
      s.prices = old.prices || {};
      s.artifactPrices = old.artifactPrices || {};
      s.sellPrices = old.sellPrices || {};
      s.cityPrices = old.cityPrices || {};
      s.cityArtifactPrices = old.cityArtifactPrices || {};
      s.citySellPrices = old.citySellPrices || {};
      s.bonusSubtypes = old.bonusSubtypes || {};
      s.craftList = old.craftList || {};
      s.stationFeeBase = old.stationFeeBase || 0;
      if(old.settings) Object.assign(s.settings, old.settings);
      return s;
    }
  }catch(e){}

  // v9（価格が都市に依存しない一律の値だったバージョン）からの移行
  // 旧の一律価格はそのまま prices/sellPrices/artifactPrices（フォールバック）として引き継ぐ。
  // 都市別の価格（cityPrices等）は空から開始し、必要な都市だけ入力していく形になる。
  try{
    const oldRaw = localStorage.getItem('albion_calc_state_v9');
    if(oldRaw){
      const old = JSON.parse(oldRaw);
      const s = defaultState();
      s.prices = old.prices || {};
      s.artifactPrices = old.artifactPrices || {};
      s.sellPrices = old.sellPrices || {};
      s.bonusSubtypes = old.bonusSubtypes || {};
      s.craftList = old.craftList || {};
      s.stationFeeBase = old.stationFeeBase || 0;
      if(old.settings) Object.assign(s.settings, old.settings);
      return s;
    }
  }catch(e){}

  // v8（都市ボーナスを手動チェックボックスで管理していたバージョン）からの移行
  // ※ どの都市を指しているかは判別できないため、クラフト都市はデフォルト(Martlock)のまま。
  //   ボーナス都市の判定は装備ごとに自動で行われるようになったため、旧cityBonus値は使わない。
  try{
    const oldRaw = localStorage.getItem('albion_calc_state_v8');
    if(oldRaw){
      const old = JSON.parse(oldRaw);
      const s = defaultState();
      s.prices = old.prices || {};
      s.artifactPrices = old.artifactPrices || {};
      s.sellPrices = old.sellPrices || {};
      s.bonusSubtypes = old.bonusSubtypes || {};
      s.craftList = old.craftList || {};
      s.stationFeeBase = old.stationFeeBase || 0;
      if(old.settings) Object.assign(s.settings, old.settings);
      delete s.settings.cityBonus;
      return s;
    }
  }catch(e){}

  // 旧: craftList["itemId"] = qty（単一ティアのみ）→ 新: craftList["itemId_T{tier}_{ench}"] = {itemId,tier,ench,qty}
  // （同じ装備を複数ティアで同時に計画できるようにするための変更）
  function migrateCraftList(oldCraftList, fallbackTier, fallbackEnch){
    const out = {};
    if(oldCraftList){
      Object.keys(oldCraftList).forEach(itemId=>{
        const qty = Number(oldCraftList[itemId])||0;
        if(qty<=0) return;
        out[craftKey(itemId, fallbackTier, fallbackEnch)] = {itemId, tier:fallbackTier, ench:fallbackEnch, qty};
      });
    }
    return out;
  }

  // 旧: settings.stationFee（一律）または stationFees["T4"]〜["T8"]（ティアごと）
  // → 新: stationFeeBase（T4.0基準額、+1レベルごとに倍）
  // 引き継ぐ際は、旧データにあるT4相当の値をそのまま基準額として使う
  function migrateStationFeeBase(oldSettings, oldStationFees){
    if(oldStationFees && Number(oldStationFees['T4'])>0) return Number(oldStationFees['T4']);
    const flat = Number(oldSettings && oldSettings.stationFee) || 0;
    return flat;
  }

  // v7（ステーション使用料をティアごとの一覧で管理していたバージョン）からの移行
  try{
    const oldRaw = localStorage.getItem('albion_calc_state_v7');
    if(oldRaw){
      const old = JSON.parse(oldRaw);
      const s = defaultState();
      s.prices = old.prices || {};
      s.artifactPrices = old.artifactPrices || {};
      s.sellPrices = old.sellPrices || {};
      s.bonusSubtypes = old.bonusSubtypes || {};
      s.craftList = old.craftList || {};
      if(old.settings) Object.assign(s.settings, old.settings);
      s.stationFeeBase = migrateStationFeeBase(old.settings, old.stationFees);
      delete s.settings.stationFee;
      delete s.settings.cityBonus;
      return s;
    }
  }catch(e){}

  // v6（作成リストは複数ティア対応したが、ステーション使用料がティア一律だったバージョン）からの移行
  try{
    const oldRaw = localStorage.getItem('albion_calc_state_v6');
    if(oldRaw){
      const old = JSON.parse(oldRaw);
      const s = defaultState();
      s.prices = old.prices || {};
      s.artifactPrices = old.artifactPrices || {};
      s.sellPrices = old.sellPrices || {};
      s.bonusSubtypes = old.bonusSubtypes || {};
      s.craftList = old.craftList || {};
      if(old.settings) Object.assign(s.settings, old.settings);
      s.stationFeeBase = migrateStationFeeBase(old.settings, null);
      delete s.settings.stationFee;
      delete s.settings.cityBonus;
      return s;
    }
  }catch(e){}

  // v5（アーティファクトを装備ごとに管理し始めたが、作成リストが単一ティアだったバージョン）からの移行
  try{
    const oldRaw = localStorage.getItem('albion_calc_state_v5');
    if(oldRaw){
      const old = JSON.parse(oldRaw);
      const s = defaultState();
      s.prices = old.prices || {};
      s.artifactPrices = old.artifactPrices || {};
      s.sellPrices = old.sellPrices || {};
      s.bonusSubtypes = old.bonusSubtypes || {};
      if(old.settings) Object.assign(s.settings, old.settings);
      s.craftList = migrateCraftList(old.craftList, s.settings.tier, s.settings.ench);
      s.stationFeeBase = migrateStationFeeBase(old.settings, null);
      delete s.settings.stationFee;
      delete s.settings.cityBonus;
      return s;
    }
  }catch(e){}

  // v4（アーティファクト価格をティア一律で管理していた旧バージョン）からの移行
  // ※ アーティファクトは装備ごとに種類が違うため金額はそのまま引き継げない。
  //   他のデータ（素材価格・売値・ボーナス設定など）はそのまま引き継ぐ。
  try{
    const oldRaw = localStorage.getItem('albion_calc_state_v4');
    if(oldRaw){
      const old = JSON.parse(oldRaw);
      const s = defaultState();
      s.prices = old.prices || {};
      s.sellPrices = old.sellPrices || {};
      s.bonusSubtypes = old.bonusSubtypes || {};
      if(old.settings) Object.assign(s.settings, old.settings);
      s.craftList = migrateCraftList(old.craftList, s.settings.tier, s.settings.ench);
      s.stationFeeBase = migrateStationFeeBase(old.settings, null);
      delete s.settings.stationFee;
      delete s.settings.cityBonus;
      return s;
    }
  }catch(e){}

  // v3（ボーナスをアイテム単位で登録していた旧バージョン）からの移行
  try{
    const oldRaw = localStorage.getItem('albion_calc_state_v3');
    if(oldRaw){
      const old = JSON.parse(oldRaw);
      const s = defaultState();
      s.prices = old.prices || {};
      s.sellPrices = old.sellPrices || {};
      if(old.settings) Object.assign(s.settings, old.settings);
      if(old.bonusItems){
        Object.keys(old.bonusItems).forEach(itemId=>{
          const it = ITEMS.find(i=>i.id===itemId);
          if(it) s.bonusSubtypes[it.category+'::'+it.subtype] = old.bonusItems[itemId];
        });
      }
      s.craftList = migrateCraftList(old.craftList, s.settings.tier, s.settings.ench);
      s.stationFeeBase = migrateStationFeeBase(old.settings, null);
      delete s.settings.stationFee;
      delete s.settings.cityBonus;
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
   端末をまたいだ利用のためのエクスポート／インポート
   （サーバーを持たない静的サイトなので、設定をファイルに書き出し／読み込みする方式）
--------------------------------------------------------------------- */
function exportState(){
  const blob = new Blob([JSON.stringify(STATE, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  a.href = url;
  a.download = `albion_calc_backup_${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importStateFromFile(file){
  const reader = new FileReader();
  reader.onload = (e)=>{
    try{
      const data = JSON.parse(e.target.result);
      if(typeof data !== 'object' || data===null) throw new Error('invalid');
      STATE = Object.assign(defaultState(), data);
      saveState();
      refreshEverything();
      alert('データを読み込みました。');
    }catch(err){
      alert('読み込みに失敗しました。エクスポートしたJSONファイルを選択してください。');
    }
  };
  reader.readAsText(file);
}

function refreshEverything(){
  renderPriceCitySelector();
  buildRefinedGrid();
  renderEquipPricePage();
  renderBonusPage();
  renderInventoryPage();
  renderBuildPage();
  renderRecoPage();
  updateTopProfit();
}

/* ---------------------------------------------------------------------
   Step⑤: AODP (Albion Online Data Project) 連携
   公開APIのため認証不要。素材・原材料はティア/エンチャントから機械的にIDを組み立てられる
   ので一括自動取得、装備はSET名等がバラバラで誤取得のリスクがあるため、
   1度だけ手動でAODPのアイテムIDを登録してもらい、以降はそのIDから自動取得する。
--------------------------------------------------------------------- */
const AODP_SERVERS = {
  west:   'https://west.albion-online-data.com',
  east:   'https://east.albion-online-data.com',
  europe: 'https://europe.albion-online-data.com',
};
let aodpServer = 'west';

async function fetchAODPPrices(itemIds, {server, locations, qualities} = {}){
  server = server || aodpServer;
  const base = AODP_SERVERS[server];
  const locStr = (locations || CITIES).join(',');
  const qStr = (qualities || [1]).join(',');
  const url = `${base}/api/v2/stats/prices/${itemIds.join(',')}.json?locations=${locStr}&qualities=${qStr}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('AODP request failed: HTTP '+res.status);
  return res.json();
}

// URL長制限（4096文字）を避けるため、アイテムIDをチャンクに分けて順番に取得する
async function fetchAODPPricesChunked(itemIds, opts, chunkSize=80){
  const all = [];
  for(let i=0; i<itemIds.length; i+=chunkSize){
    const chunk = itemIds.slice(i, i+chunkSize);
    const data = await fetchAODPPrices(chunk, opts);
    all.push(...data);
  }
  return all;
}

// 精製素材＋原材料の価格を、全都市分まとめて自動取得する
async function syncMaterialsFromAODP(statusCb){
  const ids = [];
  const idMeta = {};
  [...MATERIALS, ...RAW_MATERIALS].forEach(mat=>{
    [1,2,3].forEach(t=>{
      const id = materialAodpId(mat.id, t, 0);
      if(id){ ids.push(id); idMeta[id] = {matId:mat.id, tier:t, ench:0}; }
    });
    TIERS4to8.forEach(t=> ENCH.forEach(e=>{
      const id = materialAodpId(mat.id, t, e);
      if(id){ ids.push(id); idMeta[id] = {matId:mat.id, tier:t, ench:e}; }
    }));
  });

  if(statusCb) statusCb(`${ids.length}件のIDを取得中…`);
  const data = await fetchAODPPricesChunked(ids, {locations: CITIES});
  let count = 0;
  data.forEach(row=>{
    if(!(row.sell_price_min>0)) return;
    const meta = idMeta[row.item_id];
    if(!meta) return;
    setPrice(row.city, meta.matId, meta.tier, meta.ench, row.sell_price_min);
    count++;
  });
  return count;
}

function getAodpCode(itemId){
  return STATE.aodpMapping[itemId] || '';
}
function setAodpCode(itemId, code){
  code = (code||'').trim().toUpperCase();
  if(!code){ delete STATE.aodpMapping[itemId]; }
  else STATE.aodpMapping[itemId] = code;
  saveState();
}

// 1装備分の売値（全都市・T4〜T8・全補正段階）をAODPから取得する。
// 入力されたAODPコードのティア部分（先頭の T{n}_）を差し替えて、各ティアのIDを組み立てる。
async function syncItemFromAODP(item){
  const code = getAodpCode(item.id);
  if(!code) return 0;
  const m = code.match(/^T\d+_(.+)$/);
  if(!m) throw new Error('AODPコードは "T4_..." の形式で入力してください');
  const suffix = m[1];

  const ids = [];
  const idMeta = {};
  TIERS4to8.forEach(t=>{
    ENCH.forEach(e=>{
      const id = `T${t}_${suffix}` + (e>0 ? `@${e}` : '');
      ids.push(id);
      idMeta[id] = {tier:t, ench:e};
    });
  });

  const data = await fetchAODPPricesChunked(ids, {locations: CITIES, qualities:[1]});
  let count = 0;
  data.forEach(row=>{
    if(!(row.sell_price_min>0)) return;
    const meta = idMeta[row.item_id];
    if(!meta) return;
    setSellPrice(row.city, item.id, meta.tier, meta.ench, row.sell_price_min);
    count++;
  });
  return count;
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
function cityPriceKey(city, material, tier, ench){
  return `${city}:${priceKey(material,tier,ench)}`;
}
// 都市別の値があればそれを、なければ従来の一律価格（フォールバック）を返す
function getPrice(city, material, tier, ench){
  const v = STATE.cityPrices[cityPriceKey(city, material, tier, ench)];
  if(v!==undefined && v!==null && Number(v)>0) return Number(v);
  return Number(STATE.prices[priceKey(material,tier,ench)] || 0);
}
function setPrice(city, material, tier, ench, val){
  STATE.cityPrices[cityPriceKey(city, material, tier, ench)] = val;
  saveState();
}
function artifactPriceKey(itemId, tier){
  return `${itemId}_T${tier}`;
}
function cityArtifactPriceKey(city, itemId, tier){
  return `${city}:${artifactPriceKey(itemId, tier)}`;
}
function getArtifactPrice(city, itemId, tier){
  const v = STATE.cityArtifactPrices[cityArtifactPriceKey(city, itemId, tier)];
  if(v!==undefined && v!==null && Number(v)>0) return Number(v);
  return Number(STATE.artifactPrices[artifactPriceKey(itemId, tier)] || 0);
}
function setArtifactPrice(city, itemId, tier, val){
  STATE.cityArtifactPrices[cityArtifactPriceKey(city, itemId, tier)] = val;
  saveState();
}
// ステーション使用料：T4.0を基準（レベル0）として、ティア+エンチャントの合計が1上がるごとに倍になる
// （例：T4.0=base, T4.1=base×2, T5.0=base×2, T5.1=base×4, T8.4=base×2^20）
function stationFeeLevel(tier, ench){
  return (Number(tier)+Number(ench)) - 4;
}
function getStationFee(tier, ench){
  const level = stationFeeLevel(tier, ench);
  return (Number(STATE.stationFeeBase)||0) * Math.pow(2, level);
}
function setStationFeeBase(val){
  STATE.stationFeeBase = Number(val)||0;
  saveState();
}
function sellKey(itemId, tier, ench){
  return `${itemId}_T${tier}_${ench}`;
}
function citySellKey(city, itemId, tier, ench){
  return `${city}:${sellKey(itemId, tier, ench)}`;
}
function getSellPrice(city, itemId, tier, ench){
  const v = STATE.citySellPrices[citySellKey(city, itemId, tier, ench)];
  if(v!==undefined && v!==null && Number(v)>0) return Number(v);
  return Number(STATE.sellPrices[sellKey(itemId, tier, ench)] || 0);
}
function setSellPrice(city, itemId, tier, ench, val){
  STATE.citySellPrices[citySellKey(city, itemId, tier, ench)] = val;
  saveState();
}
// 都市の倉庫にある素材の在庫数（材料の必要数から差し引いて実際の購入必要数を出すために使う）
function inventoryKey(city, material, tier, ench){
  return `${city}:${priceKey(material, tier, ench)}`;
}
function getInventoryQty(city, material, tier, ench){
  return Number(STATE.inventory[inventoryKey(city, material, tier, ench)] || 0);
}
function setInventoryQty(city, material, tier, ench, val){
  STATE.inventory[inventoryKey(city, material, tier, ench)] = Math.max(0, Number(val)||0);
  saveState();
}
function subtypeKey(category, subtype){
  return category + '::' + subtype;
}
// 日替わり生産ボーナスは「武器種・防具種」単位（例：斧、剣、革靴）で付与されるため、
// アイテム個別ではなく category::subtype をキーとして登録する
function getBonusForSubtype(category, subtype){
  return Number(STATE.bonusSubtypes[subtypeKey(category, subtype)] || 0); // 0 / 10 / 20
}
function setBonusForSubtype(category, subtype, val){
  const key = subtypeKey(category, subtype);
  if(!val){ delete STATE.bonusSubtypes[key]; }
  else STATE.bonusSubtypes[key] = val;
  saveState();
}
function getBonus(item){
  return getBonusForSubtype(item.category, item.subtype);
}

/* ---------------------------------------------------------------------
   Resource Return Rate（Albion Online Wiki: Resource return rate に準拠）
     - 王都クラフトステーションの基本生産ボーナス：       +18%
     - 専門化（ボーナスシティ）でのクラフトボーナス：      +15%（選択中のクラフト都市がその装備の
       ボーナス都市と一致する場合のみ自動適用。手動チェックボックスは廃止）
     - フォーカス使用：                                    +59%（固定）
     - 日替わり生産ボーナス：その日選ばれた2アイテムのみ   +10% or +20%
       （アイテムごとに異なるため、対象アイテムは「原価入力 > ボーナスデー」で個別登録）
   RRR = bonus / (100 + bonus)
--------------------------------------------------------------------- */
function isCraftingInBonusCity(item, craftingCity){
  return !!(craftingCity && getBonusCity(item) === craftingCity);
}

function calcRRR(opts, item){
  let bonus = 18; // 常時：王都クラフトステーションの基本ボーナス
  if(opts.cityBonus) bonus += 15;
  if(opts.focus) bonus += 59;
  if(item) bonus += getBonus(item); // 0 / 10 / 20（登録された武器種・防具種のみ）
  const rrr = bonus / (100 + bonus);
  return {rrr, bonus};
}

function computeItemCost(item, tier, ench, craftingCity, buyingCity){
  const s = STATE.settings;
  craftingCity = craftingCity || s.craftingCity;
  buyingCity = buyingCity || s.buyingCity || craftingCity;
  const cityBonus = isCraftingInBonusCity(item, craftingCity);
  const {rrr, bonus} = calcRRR({cityBonus, focus: s.focus}, item);
  const m = item.materials || {plank:0,steel:0,leather:0,cloth:0,artifact:0};

  const breakdown = MATERIALS.map(mat=>{
    const rawQty = Number(m[mat.id])||0;
    const unitPrice = getPrice(buyingCity, mat.id, tier, ench);
    const grossCost = rawQty * unitPrice;         // 還元前の素材コスト
    const returnedValue = grossCost * rrr;         // 還元される分の金額
    const netCost = grossCost - returnedValue;      // 実質コスト
    return {id:mat.id, label:mat.label, rawQty, unitPrice, grossCost, returnedValue, netCost};
  }).filter(b=>b.rawQty>0);

  const grossMaterialCost = breakdown.reduce((sum,b)=>sum+b.grossCost, 0);
  const returnedValue = breakdown.reduce((sum,b)=>sum+b.returnedValue, 0);
  const netMaterialCost = grossMaterialCost - returnedValue;

  const artifactQty = Number(m.artifact)||0;
  const artifactCost = artifactQty * getArtifactPrice(buyingCity, item.id, tier); // アーティファクトは還元対象外・装備ごとに単価が異なる

  const stationFee = getStationFee(tier, ench); // ティア+エンチャントの合計が1上がるごとに倍
  const grossTotal = grossMaterialCost + artifactCost;               // 還元前の原価
  const total = netMaterialCost + artifactCost + stationFee;          // 実質原価合計（製造料込み）

  return {breakdown, rrr, bonus, cityBonus, craftingCity, buyingCity, grossMaterialCost, returnedValue, netMaterialCost,
           artifactQty, artifactCost, stationFee, grossTotal, total};
}

const SETUP_FEE_RATE = 2.5; // Albion Online公式仕様：出品手数料は常に2.5%固定（売り注文の時のみ発生）

function computeNetSell(sellPrice){
  const s = STATE.settings;
  const taxRate = s.premium ? 4 : 8; // プレミアムなら4%、非プレミアムなら8%
  const setupRate = s.saleType === 'order' ? SETUP_FEE_RATE : 0;
  const setupFee = sellPrice * (setupRate/100);
  const tax = sellPrice * (taxRate/100) + setupFee;
  const net = sellPrice - tax;
  return {taxRate, setupRate, setupFee, tax, net};
}

function computeProfit(item, tier, ench, sellingCity){
  const s = STATE.settings;
  sellingCity = sellingCity || s.sellingCity;
  const cost = computeItemCost(item, tier, ench);
  const sellPrice = getSellPrice(sellingCity, item.id, tier, ench);
  const {net, tax} = computeNetSell(sellPrice);
  const profit = net - cost.total;
  const margin = sellPrice>0 ? (profit/sellPrice*100) : 0;
  return {cost, sellPrice, sellingCity, net, tax, profit, margin};
}

/* ---------------------------------------------------------------------
   Step④: 素材の調達方法比較（直接買う／原材料を買って精錬する／輸送する）
   T1〜T3は精錬レシピが未定義（下位ティアが存在しないか、比率が異なるため）なので
   比較対象は T4〜T8 のみ。
--------------------------------------------------------------------- */
const TRANSPORT_FEE_RATE = 0.05; // 輸送コストの目安（積み荷紛失リスク等を織り込んだ概算率。実態に合わせて調整可）

function compareSourcingOptions(materialId, tier, ench, qty){
  const s = STATE.settings;
  const rawId = 'raw_' + materialId;
  const bonusCity = REFINE_BONUS_CITY[materialId];
  const recipe = REFINE_RECIPE[tier];

  // A. 直接買う：全都市のうち最安値
  const buyOptions = CITIES.map(city => ({
    city, unitCost: getPrice(city, materialId, tier, ench),
  })).filter(o => o.unitCost>0);
  const buyLocal = buyOptions.sort((a,b)=>a.unitCost-b.unitCost)[0];

  // B. 原材料を買って、ボーナス都市で精錬する（還元率が原材料の実質消費量を下げる）
  let refine = null;
  if(recipe && bonusCity){
    const rawPrice = getPrice(bonusCity, rawId, tier, ench);
    const lowerPrice = recipe.lowerQty>0 ? getPrice(bonusCity, materialId, recipe.lowerTier, ench) : 0;
    if(rawPrice>0){
      const {rrr} = calcRRR({cityBonus:true, focus:s.focus}); // 精錬所もそのボーナス都市にある前提
      const grossCost = (rawPrice*recipe.raw) + (lowerPrice*recipe.lowerQty);
      refine = { city: bonusCity, unitCost: grossCost * (1-rrr), grossCost };
    }
  }

  // C. 他都市の安い在庫を輸送してくる（想定輸送コスト率を加算）
  const transport = buyLocal
    ? { city: buyLocal.city, unitCost: buyLocal.unitCost * (1+TRANSPORT_FEE_RATE) }
    : null;

  const options = [
    buyLocal && {method:'buy', label:'直接購入', ...buyLocal},
    refine && {method:'refine', label:'精錬する', ...refine},
    transport && {method:'transport', label:'輸送する', ...transport},
  ].filter(Boolean);

  options.forEach(o => o.totalCost = o.unitCost * qty);
  options.sort((a,b)=>a.unitCost-b.unitCost);
  return { best: options[0] || null, all: options };
}

/* ---------------------------------------------------------------------
   Step⑥: 都市ルート・予算の推奨アルゴリズム
   ロイヤル5都市は環状（Martlock↔Thetford↔FortSterling↔Lymhurst↔Bridgewatch↔Martlock）。
   Caerleonは中心に位置し、距離・移動時間は評価対象から除外（工程の最後に任意で寄る想定）。
--------------------------------------------------------------------- */
const CITY_RING = ['Martlock', 'Thetford', 'FortSterling', 'Lymhurst', 'Bridgewatch']; // Caerleonはリングに含めない
const RISK = { ROYAL: 0, CAERLEON: 2 };

function ringDistance(cityA, cityB){
  if(cityA===cityB) return 0;
  if(cityA==='Caerleon' || cityB==='Caerleon') return null; // 仕様により距離評価の対象外
  const n = CITY_RING.length;
  const ia = CITY_RING.indexOf(cityA), ib = CITY_RING.indexOf(cityB);
  const diff = Math.abs(ia-ib);
  return Math.min(diff, n-diff);
}
function routeRisk(cities){
  return cities.includes('Caerleon') ? RISK.CAERLEON : RISK.ROYAL;
}

/**
 * item を tier.ench で qty 個作る場合の、買う都市→作る都市→売る都市の組み合わせを
 * 総当たりで評価し、利益/時間が高い順に上位を返す。
 * opts.includeCaerleon が true のときだけ、カエルレオン絡みのルート（距離は考慮せず参考値として）も候補に含める。
 */
function recommendRoutes(item, tier, ench, qty, {budget, maxRiskTier, includeCaerleon}={}){
  budget = budget>0 ? budget : Infinity;
  maxRiskTier = maxRiskTier!==undefined ? maxRiskTier : RISK.ROYAL;
  const results = [];
  const candidateCities = includeCaerleon ? CITIES : CITY_RING;

  candidateCities.forEach(buyCity=>{
    candidateCities.forEach(craftCity=>{
      candidateCities.forEach(sellCity=>{
        const riskTier = routeRisk([buyCity, craftCity, sellCity]);
        if(riskTier > maxRiskTier) return;

        const cost = computeItemCost(item, tier, ench, craftCity, buyCity);
        const materialCost = cost.total * qty;
        if(materialCost > budget) return;

        const sellPrice = getSellPrice(sellCity, item.id, tier, ench);
        if(sellPrice<=0) return;
        const {net} = computeNetSell(sellPrice);
        const profit = (net - cost.total) * qty;

        // 移動時間モデル：リング距離の合計（カエルレオン絡みの区間は距離評価から除外＝0扱い）
        const legDistBuyCraft = ringDistance(buyCity, craftCity);
        const legDistCraftSell = ringDistance(craftCity, sellCity);
        const legs = (legDistBuyCraft||0) + (legDistCraftSell||0);
        const estHours = 0.25*legs + 0.15; // 1リング区間=0.25時間 + クラフト等の固定時間0.15時間（目安。実測に合わせて調整可）
        const profitPerHour = profit / estHours;

        results.push({buyCity, craftCity, sellCity, cost, materialCost, sellPrice, profit, profitPerHour, riskTier, legs});
      });
    });
  });

  return results.sort((a,b)=>b.profitPerHour-a.profitPerHour).slice(0,10);
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
    if(page==='route') renderRoutePage();
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
    if(btn.dataset.sub==='inventory') renderInventoryPage();
  });
});

document.getElementById('resetBtn').addEventListener('click', ()=>{
  if(confirm('すべての価格・設定をリセットしますか？')){
    localStorage.removeItem(LS_KEY);
    STATE = defaultState();
    refreshEverything();
  }
});

document.getElementById('exportBtn').addEventListener('click', exportState);
document.getElementById('importBtn').addEventListener('click', ()=>{
  document.getElementById('importFileInput').click();
});
document.getElementById('importFileInput').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(file) importStateFromFile(file);
  e.target.value = ''; // 同じファイルを連続で選んでも change が発火するように
});

document.getElementById('aodpServerSelect').addEventListener('change', e=>{ aodpServer = e.target.value; });
document.getElementById('aodpSyncMaterialsBtn').addEventListener('click', async ()=>{
  const statusEl = document.getElementById('aodpMaterialsStatus');
  statusEl.textContent = '取得中…（少し時間がかかります）';
  statusEl.className = 'aodpstatus';
  try{
    const count = await syncMaterialsFromAODP(msg=>{ statusEl.textContent = msg; });
    statusEl.textContent = `${count}件の価格を取得・反映しました`;
    statusEl.className = 'aodpstatus ok';
    buildRefinedGrid();
    updateTopProfit();
  }catch(err){
    statusEl.textContent = '取得失敗: '+err.message+'（サーバーを変えて再試行してみてください）';
    statusEl.className = 'aodpstatus err';
  }
});

/* =======================================================================
   PAGE 1-A: 精製素材 price grid
======================================================================= */
/* =======================================================================
   価格入力の対象都市（精製素材・装備売値・アーティファクトで共有）
======================================================================= */
let priceEntryCity = 'Martlock';

function renderPriceCitySelector(){
  const wrap = document.getElementById('priceCityRow');
  if(!wrap) return;
  wrap.innerHTML = CITIES.map(c=>
    `<button type="button" class="citybtn${c===priceEntryCity?' active':''}" data-city="${c}">${CITY_LABELS_JA[c]}</button>`
  ).join('');
  wrap.querySelectorAll('.citybtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      priceEntryCity = btn.dataset.city;
      renderPriceCitySelector();
      buildRefinedGrid();
      renderEquipPricePage();
    });
  });
}

/* =======================================================================
   PAGE 1-A: 精製素材 price grid
======================================================================= */
function buildRefinedGrid(){
  buildMaterialGrid('refinedGrid', MATERIALS);
  buildMaterialGrid('rawGrid', RAW_MATERIALS);
}
function buildMaterialGrid(wrapId, matList){
  const wrap = document.getElementById(wrapId);
  if(!wrap) return;
  wrap.innerHTML = '';
  matList.forEach(mat=>{
    const col = document.createElement('div');
    col.className = 'pricecol';
    let html = `<h5>${mat.label}</h5>`;
    [1,2,3].forEach(t=> html += rowHtml(mat.id, t, 0, `T${t}`) );
    TIERS4to8.forEach(t=> ENCH.forEach(e=> html += rowHtml(mat.id, t, e, `T${t}.${e}`) ));
    col.innerHTML = html;
    wrap.appendChild(col);
  });

  wrap.querySelectorAll('input[data-mat]').forEach(inp=>{
    inp.value = getPrice(priceEntryCity, inp.dataset.mat, inp.dataset.tier, inp.dataset.ench) || '';
    inp.addEventListener('input', ()=>{
      setPrice(priceEntryCity, inp.dataset.mat, inp.dataset.tier, inp.dataset.ench, Number(inp.value)||0);
      updateTopProfit();
    });
  });
}
function rowHtml(matId, tier, ench, label){
  return `<div class="prow"><label>${label}</label>
    <input type="number" min="0" placeholder="0" data-mat="${matId}" data-tier="${tier}" data-ench="${ench}"></div>`;
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
    html += `<div class="aodprow">
      <input type="text" class="aodpinput" placeholder="AODPコード (例: T4_HEAD_PLATE_SET1)" data-aodp-item="${item.id}" value="${getAodpCode(item.id)}">
      <button type="button" class="tinybtn aodpsyncbtn" data-aodp-item="${item.id}">取得</button>
    </div>
    <div class="aodpstatus" data-aodp-status="${item.id}"></div>`;
    html += `<div class="prow subtle" style="padding-top:6px;"><label style="font-weight:700;color:var(--text-faint);">売値</label></div>`;
    TIERS4to8.forEach(t=>{
      ENCH.forEach(e=>{
        html += `<div class="prow"><label>T${t}.${e}</label>
          <input type="number" min="0" placeholder="0" data-item="${item.id}" data-tier="${t}" data-ench="${e}"></div>`;
      });
    });
    if(isArtifactItem(item)){
      html += `<div class="prow subtle artifact-subhead"><label>アーティファクト欠片単価</label></div>`;
      TIERS4to8.forEach(t=>{
        html += `<div class="prow"><label>T${t}</label>
          <input type="number" min="0" placeholder="0" class="artifact-input" data-artifact-item="${item.id}" data-artifact-tier="${t}"></div>`;
      });
    }
    col.innerHTML = html;
    grid.appendChild(col);
  });

  grid.querySelectorAll('input[data-item]').forEach(inp=>{
    inp.value = getSellPrice(priceEntryCity, inp.dataset.item, inp.dataset.tier, inp.dataset.ench) || '';
    inp.addEventListener('input', ()=>{
      setSellPrice(priceEntryCity, inp.dataset.item, Number(inp.dataset.tier), Number(inp.dataset.ench), Number(inp.value)||0);
      updateTopProfit();
    });
  });

  grid.querySelectorAll('input[data-artifact-item]').forEach(inp=>{
    inp.value = getArtifactPrice(priceEntryCity, inp.dataset.artifactItem, inp.dataset.artifactTier) || '';
    inp.addEventListener('input', ()=>{
      setArtifactPrice(priceEntryCity, inp.dataset.artifactItem, Number(inp.dataset.artifactTier), Number(inp.value)||0);
      updateTopProfit();
    });
  });

  grid.querySelectorAll('.aodpinput').forEach(inp=>{
    inp.addEventListener('change', ()=> setAodpCode(inp.dataset.aodpItem, inp.value));
  });
  grid.querySelectorAll('.aodpsyncbtn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const itemId = btn.dataset.aodpItem;
      const item = ITEMS.find(i=>i.id===itemId);
      const statusEl = grid.querySelector(`[data-aodp-status="${CSS.escape(itemId)}"]`);
      const codeInput = grid.querySelector(`.aodpinput[data-aodp-item="${CSS.escape(itemId)}"]`);
      setAodpCode(itemId, codeInput.value);
      if(!getAodpCode(itemId)){ statusEl.textContent='先にAODPコードを入力してください'; statusEl.className='aodpstatus err'; return; }
      statusEl.textContent = '取得中…'; statusEl.className = 'aodpstatus';
      try{
        const count = await syncItemFromAODP(item);
        statusEl.textContent = count>0 ? `${count}件の価格を取得しました` : '価格が見つかりませんでした（コードを確認してください）';
        statusEl.className = 'aodpstatus ' + (count>0?'ok':'err');
        renderEquipPricePage();
        updateTopProfit();
      }catch(err){
        statusEl.textContent = '取得失敗: '+err.message;
        statusEl.className = 'aodpstatus err';
      }
    });
  });
}

/* =======================================================================
   PAGE 1-D: ボーナスデー — その日ボーナス対象の「武器種・防具種」を登録
   （日替わり生産ボーナスは個別アイテムではなく種類単位で付与される）
======================================================================= */
let bonusCategory = 'weapon';

function renderBonusPage(){
  // 現在登録中の一覧
  const activeKeys = Object.keys(STATE.bonusSubtypes);
  const activeWrap = document.getElementById('bonusActiveList');
  if(activeKeys.length===0){
    activeWrap.innerHTML = `<div class="empty-hint">まだ登録されていません。下からカテゴリ→種類を選んでボーナスを設定してください。</div>`;
  }else{
    activeWrap.innerHTML = activeKeys.map(key=>{
      const [cat, sub] = key.split('::');
      const catLabel = (CATS.find(c=>c.id===cat)||{}).label || cat;
      const subLabel = SUBTYPE_LABELS[sub] || sub;
      const sample = ITEMS.find(i=>i.category===cat && i.subtype===sub);
      const val = STATE.bonusSubtypes[key];
      return `<div class="bonuschip">
        ${sample ? `<img src="${sample.file}" alt="">` : ''}
        <span>${catLabel} / ${subLabel}</span>
        <span class="bonuspct">+${val}%</span>
        <button type="button" class="tinybtn removebtn" data-key="${key}">解除</button>
      </div>`;
    }).join('');
    activeWrap.querySelectorAll('.removebtn').forEach(b=>{
      b.addEventListener('click', ()=>{
        const [cat, sub] = b.dataset.key.split('::');
        setBonusForSubtype(cat, sub, 0);
        renderBonusPage();
        updateTopProfit();
      });
    });
  }

  // カテゴリ選択
  const catRow = document.getElementById('bonusCatRow');
  catRow.innerHTML = '';
  CATS.forEach(c=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'equipcatbtn' + (c.id===bonusCategory ? ' active' : '');
    btn.innerHTML = `<span class="ic">${c.ic}</span>${c.label}`;
    btn.addEventListener('click', ()=>{ bonusCategory = c.id; renderBonusPage(); });
    catRow.appendChild(btn);
  });

  // 種類（武器種・防具種）を画像アイコンで選択 → クリックで なし→+10%→+20%→なし と切り替え
  const subRow = document.getElementById('bonusSubtypeRow');
  subRow.innerHTML = '';
  const order = SUBTYPE_ORDER[bonusCategory] || [null];
  const groups = order.map(sub=>({
    sub,
    label: sub===null ? (CATS.find(c=>c.id===bonusCategory)||{}).label : (SUBTYPE_LABELS[sub]||sub),
    items: ITEMS.filter(i=>i.category===bonusCategory && i.subtype===sub),
  })).filter(g=>g.items.length>0);

  groups.forEach(g=>{
    const cur = getBonusForSubtype(bonusCategory, g.sub);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'subtypeicon bonussubtype' + (cur>0 ? ' active bonus'+cur : '');
    btn.innerHTML = `<img src="${g.items[0].file}" alt=""><span>${g.label}</span><span class="micount">${cur>0?'+'+cur+'%':'なし'}</span>`;
    btn.addEventListener('click', ()=>{
      const next = cur===0 ? 10 : (cur===10 ? 20 : 0); // なし→+10%→+20%→なし
      setBonusForSubtype(bonusCategory, g.sub, next);
      renderBonusPage();
      updateTopProfit();
    });
    subRow.appendChild(btn);
  });
}

/* =======================================================================
   PAGE 1-E: 在庫 — 都市の倉庫にある素材の在庫数を登録
   （作成リストの「必要な素材」から自動的に差し引かれ、実際の購入必要数がわかる）
======================================================================= */
let inventoryCity = 'Martlock';

function renderInventoryPage(){
  const catRow = document.getElementById('inventoryCityRow');
  catRow.innerHTML = CITIES.map(c=>
    `<button type="button" class="citybtn${c===inventoryCity?' active':''}" data-city="${c}">${CITY_LABELS_JA[c]}</button>`
  ).join('');
  catRow.querySelectorAll('.citybtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      inventoryCity = btn.dataset.city;
      renderInventoryPage();
    });
  });

  const wrap = document.getElementById('inventoryGrid');
  wrap.innerHTML = '';
  MATERIALS.forEach(mat=>{
    const col = document.createElement('div');
    col.className = 'pricecol';
    let html = `<h5>${mat.label}</h5>`;
    [1,2,3].forEach(t=> html += invRowHtml(mat.id, t, 0, `T${t}`) );
    TIERS4to8.forEach(t=> ENCH.forEach(e=> html += invRowHtml(mat.id, t, e, `T${t}.${e}`) ));
    col.innerHTML = html;
    wrap.appendChild(col);
  });

  wrap.querySelectorAll('input[data-mat]').forEach(inp=>{
    inp.value = getInventoryQty(inventoryCity, inp.dataset.mat, inp.dataset.tier, inp.dataset.ench) || '';
    // change（フォーカスが外れた時）で反映：数値入力の1文字ずつ問題を避けるため
    inp.addEventListener('change', ()=>{
      setInventoryQty(inventoryCity, inp.dataset.mat, inp.dataset.tier, inp.dataset.ench, inp.value);
      renderCraftListPanel();
    });
  });
}
function invRowHtml(matId, tier, ench, label){
  return `<div class="prow"><label>${label}</label>
    <input type="number" min="0" placeholder="0" data-mat="${matId}" data-tier="${tier}" data-ench="${ench}"></div>`;
}


/* =======================================================================
   共通設定バー（RRR・製造料・売却手数料）— 作成リストで使用
======================================================================= */
function renderSettingsBar(container, opts){
  const s = STATE.settings;
  const rrrBonus = calcRRR({cityBonus:true, focus:s.focus}).rrr;
  const rrrNoBonus = calcRRR({cityBonus:false, focus:s.focus}).rrr;
  container.innerHTML = `
    <div class="card settingsbar">
      <div class="settingsbar-row">
        <div class="field" style="max-width:120px;">
          <label>新規追加時ティア</label>
          <select id="stTier">
            ${TIERS4to8.map(t=>`<option value="${t}" ${t==s.tier?'selected':''}>T${t}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="max-width:120px;">
          <label>新規追加時補正</label>
          <select id="stEnch">
            ${ENCH.map(e=>`<option value="${e}" ${e==s.ench?'selected':''}>.${e}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="max-width:170px;">
          <label>クラフト都市</label>
          <select id="stCraftingCity">
            ${CITIES.map(c=>`<option value="${c}" ${c===s.craftingCity?'selected':''}>${CITY_LABELS_JA[c]}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="max-width:170px;">
          <label>購入都市（素材・欠片）</label>
          <select id="stBuyingCity">
            ${CITIES.map(c=>`<option value="${c}" ${c===s.buyingCity?'selected':''}>${CITY_LABELS_JA[c]}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="max-width:170px;">
          <label>販売都市</label>
          <select id="stSellingCity">
            ${CITIES.map(c=>`<option value="${c}" ${c===s.sellingCity?'selected':''}>${CITY_LABELS_JA[c]}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="max-width:150px;">
          <label>売却方法</label>
          <select id="stSaleType">
            <option value="quick" ${s.saleType==='quick'?'selected':''}>クイック売却</option>
            <option value="order" ${s.saleType==='order'?'selected':''}>売り注文（+出品手数料2.5%固定）</option>
          </select>
        </div>
        <label class="minitoggle">
          <input type="checkbox" id="stPremium" ${s.premium?'checked':''}>
          <span class="slider"></span>
          <span class="mtlabel">プレミアム（税4%／なしなら8%）</span>
        </label>
        <label class="minitoggle">
          <input type="checkbox" id="stFocus" ${s.focus?'checked':''}>
          <span class="slider"></span>
          <span class="mtlabel">フォーカス使用(+59%)</span>
        </label>
        <div class="pill" style="margin-left:auto;">ボーナス都市一致時 <b class="rrr-hit">${(rrrBonus*100).toFixed(2)}%</b> ／ 対象外 <b class="rrr-miss">${(rrrNoBonus*100).toFixed(2)}%</b></div>
      </div>
      <div class="field" style="max-width:220px;margin-top:4px;">
        <label>ステーション使用料（T4.0時点・silver）</label>
        <input type="number" id="stStationFeeBase" min="0" placeholder="0" value="${STATE.stationFeeBase||''}">
      </div>
      <div class="note">
        「新規追加時ティア／補正」は、下のリストから<b>新しく追加する</b>装備に使われるデフォルト値です。作成リストに追加済みの各行は、行ごとに個別のティア・補正段階を選べます（複数ティアを同時に計画できます）。<br>
        「クラフト都市」を選ぶと、その都市がボーナス都市になっている装備だけ自動的に+15%のボーナス還元率が適用されます。「購入都市」「販売都市」は、原価入力タブで都市ごとに入力した価格のうち、原価計算・利益計算にどの都市の価格を使うかを切り替えます（都市別の価格が未入力の場合は、都市を問わない一律価格にフォールバックします）。<br>
        ステーション使用料は「ティア＋補正段階の合計」が1上がるごとに倍になります（T4.0の金額を入力すれば、T4.1〜T8.4は自動計算されます。例：T4.1とT5.0は同額、T4.2とT5.1とT6.0は同額です）。<br>
        日替わりボーナス（+10%/+20%）は「原価入力 &gt; ボーナスデー」で登録した対象の武器種・防具種にのみ自動で加算されます。出品手数料は常に2.5%固定（売り注文の時のみ）、取引税はプレミアムなら4%・なしなら8%です。
      </div>
    </div>
  `;

  document.getElementById('stTier').addEventListener('change', e=>{ s.tier=Number(e.target.value); saveState(); });
  document.getElementById('stEnch').addEventListener('change', e=>{ s.ench=Number(e.target.value); saveState(); });
  document.getElementById('stCraftingCity').addEventListener('change', e=>{ s.craftingCity=e.target.value; saveState(); renderCraftListPanel(); updateTopProfit(); });
  document.getElementById('stBuyingCity').addEventListener('change', e=>{ s.buyingCity=e.target.value; saveState(); renderCraftListPanel(); updateTopProfit(); });
  document.getElementById('stSellingCity').addEventListener('change', e=>{ s.sellingCity=e.target.value; saveState(); renderCraftListPanel(); updateTopProfit(); });
  document.getElementById('stStationFeeBase').addEventListener('change', e=>{
    setStationFeeBase(e.target.value);
    renderCraftListPanel();
    updateTopProfit();
  });
  document.getElementById('stSaleType').addEventListener('change', e=>{ s.saleType=e.target.value; saveState(); renderCraftListPanel(); updateTopProfit(); });
  document.getElementById('stPremium').addEventListener('change', e=>{ s.premium=e.target.checked; saveState(); renderCraftListPanel(); updateTopProfit(); });
  document.getElementById('stFocus').addEventListener('change', e=>{ s.focus=e.target.checked; saveState(); renderSettingsBar(container, opts); renderCraftListPanel(); updateTopProfit(); });
}

/* =======================================================================
   グループ化されたアイテムピッカー（種類ごとに折りたたみ）— 作成リストで使用
======================================================================= */
const pickerUIState = {
  activeCategory: {build:'head', route:'head'},
  searchTerm: {build:'', route:''},
  expandedGroups: {build:new Set(), route:new Set()},
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
   craftList は itemId+tier+ench をキーにして保存するため、同じ装備でも
   複数ティアを同時に計画できる（例：T6用とT8用を両方リストに入れる）。
======================================================================= */
function craftKey(itemId, tier, ench){
  return `${itemId}_T${tier}_${ench}`;
}

function addToCraftList(itemId, tier, ench, qty){
  tier = tier || STATE.settings.tier;
  ench = ench !== undefined ? ench : STATE.settings.ench;
  qty = Math.max(1, Number(qty)||1);
  const key = craftKey(itemId, tier, ench);
  const existing = STATE.craftList[key];
  if(existing) existing.qty += qty;
  else STATE.craftList[key] = {itemId, tier, ench, qty};
  saveState();
  renderCraftListPanel();
  updateTopProfit();
}
function setCraftQty(key, qty){
  qty = Math.max(0, Number(qty)||0);
  const entry = STATE.craftList[key];
  if(!entry) return;
  if(qty===0){ delete STATE.craftList[key]; }
  else entry.qty = qty;
  saveState();
  renderCraftListPanel();
  updateTopProfit();
}
function setCraftTierEnch(key, newTier, newEnch){
  const entry = STATE.craftList[key];
  if(!entry) return;
  delete STATE.craftList[key];
  const newKey = craftKey(entry.itemId, newTier, newEnch);
  if(STATE.craftList[newKey]) STATE.craftList[newKey].qty += entry.qty;
  else STATE.craftList[newKey] = {itemId: entry.itemId, tier:newTier, ench:newEnch, qty:entry.qty};
  saveState();
  renderCraftListPanel();
  updateTopProfit();
}
function removeFromCraftList(key){
  delete STATE.craftList[key];
  saveState();
  renderCraftListPanel();
  updateTopProfit();
}

function renderBuildPage(){
  renderSettingsBar(document.getElementById('buildSettingsBar'), {onChange: renderBuildPage});
  renderCategorySidebar('build', document.getElementById('buildCategoryList'), renderBuildPage);

  const search = document.getElementById('buildSearch');
  search.value = pickerUIState.searchTerm.build;
  search.oninput = (e)=>{ pickerUIState.searchTerm.build = e.target.value.trim().toLowerCase(); renderBuildPage(); };

  renderItemPicker('build', document.getElementById('buildItemList'), (item)=>{
    const row = document.createElement('div');
    row.className = 'itemrow';
    row.innerHTML = `
      <img src="${item.file}" alt="${item.name}">
      <div class="irname">${item.name}${isArtifactItem(item)?'<span class="tag-artifact">Artifact</span>':''}</div>
      <div class="irfield" style="max-width:70px;">
        <input type="number" min="1" placeholder="1" class="addqtyinput">
      </div>
      <button type="button" class="tinybtn addbtn">追加</button>
    `;
    const qtyInput = row.querySelector('.addqtyinput');
    row.querySelector('.addbtn').addEventListener('click', ()=>{
      addToCraftList(item.id, STATE.settings.tier, STATE.settings.ench, qtyInput.value);
      qtyInput.value = '';
    });
    return row;
  });

  renderCraftListPanel();
}

function renderCraftListPanel(){
  const wrap = document.getElementById('craftListPanel');
  const entries = Object.keys(STATE.craftList)
    .map(key=>{
      const entry = STATE.craftList[key];
      return {key, entry, item: ITEMS.find(i=>i.id===entry.itemId)};
    })
    .filter(e=>e.item && e.entry.qty>0);

  if(entries.length===0){
    wrap.innerHTML = `<div class="empty-hint">左のリストから装備を選んで「追加」すると、ここに原価・利益の内訳がまとまります</div>`;
    return;
  }

  const totals = {gross:0, returned:0, station:0, artifact:0, cost:0, sell:0, tax:0, profit:0};
  const materialByTier = {}; // { "T4.0": { plank:{qty,cost}, ... }, ... }
  const artifactLines = []; // [{item, qty, unitPrice, totalCost}]
  const s = STATE.settings;

  function tierEnchLabel(tier, ench){ return `T${tier}.${ench}`; }

  const rows = entries.map(({key, entry, item})=>{
    const {tier, ench, qty} = entry;
    const c = computeItemCost(item, tier, ench);
    const sellPrice = getSellPrice(s.sellingCity, item.id, tier, ench);
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

    const teLabel = tierEnchLabel(tier, ench);
    if(!materialByTier[teLabel]){
      materialByTier[teLabel] = {};
      MATERIALS.forEach(m=> materialByTier[teLabel][m.id] = {qty:0, cost:0} );
    }
    c.breakdown.forEach(b=>{
      materialByTier[teLabel][b.id].qty += b.rawQty*qty;
      materialByTier[teLabel][b.id].cost += b.grossCost*qty;
    });
    if(c.artifactQty>0){
      const unitPrice = getArtifactPrice(c.buyingCity, item.id, tier);
      artifactLines.push({item, tier, ench, qty: c.artifactQty*qty, unitPrice, totalCost: c.artifactCost*qty});
    }

    const bCity = getBonusCity(item);
    const cityBadge = bCity
      ? (c.cityBonus
          ? `<span class="citybadge citybadge-hit">🏙 ${CITY_LABELS_JA[bCity]}(ボーナス中)</span>`
          : `<span class="citybadge citybadge-miss">ボーナス都市: ${CITY_LABELS_JA[bCity]}</span>`)
      : '';

    return `
      <div class="buildrow">
        <div class="brhead">
          <img src="${item.file}" alt="${item.name}">
          <div class="irname">${item.name}${isArtifactItem(item)?'<span class="tag-artifact">Artifact</span>':''}${cityBadge}</div>
          <select class="crafttier" data-key="${key}">
            ${TIERS4to8.map(t=>`<option value="${t}" ${t===tier?'selected':''}>T${t}</option>`).join('')}
          </select>
          <select class="craftench" data-key="${key}">
            ${ENCH.map(e=>`<option value="${e}" ${e===ench?'selected':''}>.${e}</option>`).join('')}
          </select>
          <input type="number" min="0" class="craftqty" data-key="${key}" value="${qty}">
          <button type="button" class="tinybtn removebtn" data-key="${key}">削除</button>
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

  // ティア・補正段階の若い順に並べる
  const teKeys = Object.keys(materialByTier).sort((a,b)=>{
    const [at,ae] = a.slice(1).split('.').map(Number);
    const [bt,be] = b.slice(1).split('.').map(Number);
    return (at-bt) || (ae-be);
  });

  // 在庫（購入都市の倉庫）を必要数から差し引き、実際の購入必要数・購入コストを算出
  let inventorySavings = 0;
  const matGroupsHtml = teKeys.map(teLabel=>{
    const [t, e] = teLabel.slice(1).split('.').map(Number);
    const mats = materialByTier[teLabel];
    const rowsHtml = MATERIALS.map(m=>{
      const need = mats[m.id];
      if(need.qty<=0) return '';
      const owned = getInventoryQty(s.buyingCity, m.id, t, e);
      const unitPrice = need.qty>0 ? need.cost/need.qty : 0;
      const usedFromStock = Math.min(owned, need.qty);
      const toBuy = Math.max(0, need.qty - owned);
      const buyCost = toBuy * unitPrice;
      inventorySavings += usedFromStock * unitPrice;

      const qtyLine = owned>0
        ? `必要 ${fmt(need.qty)} － 在庫 ${fmt(usedFromStock)} = 購入 ${fmt(toBuy)} 個`
        : `${fmt(need.qty)} 個`;

      const sourcing = compareSourcingOptions(m.id, t, e, Math.max(toBuy,1));
      const sourceBadge = sourcing.best
        ? `<span class="sourcebadge sb-${sourcing.best.method}">${sourcing.best.label}@${CITY_LABELS_JA[sourcing.best.city]}</span>`
        : '';

      return `<div class="matneedrow"><span class="mnlabel">${m.label}${sourceBadge}</span><span class="mnqty">${qtyLine}</span><span class="mncost">${fmt(owned>0?buyCost:need.cost)}</span></div>`;
    }).join('');
    if(!rowsHtml) return '';
    return `<div class="matneedgroup">
      <div class="matneedgroup-title">${teLabel}（購入都市: ${CITY_LABELS_JA[s.buyingCity]}の在庫を差し引き済み）</div>
      ${rowsHtml}
    </div>`;
  }).join('');

  const artGroupsHtml = teKeys.map(teLabel=>{
    const [t,e] = teLabel.slice(1).split('.').map(Number);
    const lines = artifactLines.filter(a=>a.tier===t && a.ench===e);
    if(lines.length===0) return '';
    return `<div class="artneeds">
      <div class="matneedgroup-title">${teLabel} のアーティファクト</div>
      ${lines.map(a=>`
        <div class="artneedrow">
          <img class="artthumb" src="${a.item.file}" alt="${a.item.name}">
          <span class="artmult">× ${fmt(a.qty)}</span>
          <span class="artname">${a.item.name}</span>
          <span class="artcost">${fmt(a.totalCost)}</span>
        </div>`).join('')}
    </div>`;
  }).join('');

  const netCostAfterInventory = Math.max(0, totals.cost - inventorySavings);
  const netProfitAfterInventory = totals.profit + inventorySavings;

  wrap.innerHTML = `
    <div class="card">
      <h3>作成リスト（${entries.length}行）</h3>
      <div class="sub">行ごとにティア・補正段階を個別に選べます。複数ティアを同時に計画できます。</div>
      <div class="buildrows">${rows}</div>
    </div>
    <div class="card summary-box">
      <div class="summary-title">必要な素材（ティア・補正段階ごと）</div>
      ${matGroupsHtml || `<div class="srow"><span class="k">素材データなし</span></div>`}
      ${artGroupsHtml}
    </div>
    <div class="card summary-box">      <div class="summary-title">合計</div>
      <div class="srow"><span class="k">素材原価（還元前）</span><span class="v">${fmt(totals.gross-totals.artifact)}</span></div>
      <div class="srow"><span class="k">還元額</span><span class="v profit-pos">-${fmt(totals.returned)}</span></div>
      <div class="srow"><span class="k">アーティファクト代</span><span class="v">${fmt(totals.artifact)}</span></div>
      <div class="srow"><span class="k">製造料</span><span class="v">${fmt(totals.station)}</span></div>
      <div class="srow"><span class="k">実質原価合計</span><span class="v">${fmt(totals.cost)}</span></div>
      <div class="srow"><span class="k">売値合計</span><span class="v">${fmt(totals.sell)}</span></div>
      <div class="srow"><span class="k">税金・出品手数料</span><span class="v">-${fmt(totals.tax)}</span></div>
      <div class="srow total"><span class="k">合計利益</span><span class="v ${totals.profit>=0?'profit-pos':'profit-neg'}">${totals.profit>=0?'+':''}${fmt(totals.profit)}</span></div>
      <div class="srow"><span class="k">合計利益率</span><span class="v ${totalMargin>=0?'profit-pos':'profit-neg'}">${totals.sell>0?totalMargin.toFixed(1)+'%':'—'}</span></div>
      ${inventorySavings>0 ? `
      <div class="srow"><span class="k">在庫による節約</span><span class="v profit-pos">-${fmt(inventorySavings)}</span></div>
      <div class="srow total"><span class="k">在庫考慮後の実質原価</span><span class="v">${fmt(netCostAfterInventory)}</span></div>
      <div class="srow"><span class="k">在庫考慮後の合計利益</span><span class="v ${netProfitAfterInventory>=0?'profit-pos':'profit-neg'}">${netProfitAfterInventory>=0?'+':''}${fmt(netProfitAfterInventory)}</span></div>
      ` : ''}
    </div>
  `;

  // 数量は change（フォーカスが外れた時）で反映：入力のたびに全体を再描画すると
  // 1文字入力するごとにフォーカスが外れてしまう不具合があったため
  wrap.querySelectorAll('.craftqty').forEach(inp=>{
    inp.addEventListener('change', e=>setCraftQty(e.target.dataset.key, e.target.value));
  });
  wrap.querySelectorAll('.crafttier').forEach(sel=>{
    sel.addEventListener('change', e=>{
      const key = e.target.dataset.key;
      const enchSel = wrap.querySelector(`.craftench[data-key="${CSS.escape(key)}"]`);
      setCraftTierEnch(key, Number(e.target.value), Number(enchSel.value));
    });
  });
  wrap.querySelectorAll('.craftench').forEach(sel=>{
    sel.addEventListener('change', e=>{
      const key = e.target.dataset.key;
      const tierSel = wrap.querySelector(`.crafttier[data-key="${CSS.escape(key)}"]`);
      setCraftTierEnch(key, Number(tierSel.value), Number(e.target.value));
    });
  });
  wrap.querySelectorAll('.removebtn').forEach(btn=>{
    btn.addEventListener('click', e=>removeFromCraftList(e.target.dataset.key));
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
        const sp = getSellPrice(s.sellingCity, item.id, t, e);
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
      <div class="sub">現在入力済みの売値をもとに、利益率が高い順に表示しています（還元率・手数料は共通設定を使用）。個数を指定して「作成リストに追加」できます。</div>
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
            <div class="irfield" style="max-width:64px;">
              <input type="number" min="1" placeholder="1" class="recoqty" data-idx="${idx}">
            </div>
            <button type="button" class="tinybtn recoaddbtn" data-idx="${idx}">作成リストに追加</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  wrap.querySelectorAll('.recoaddbtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const r = top[Number(btn.dataset.idx)];
      const qtyInput = wrap.querySelector(`.recoqty[data-idx="${btn.dataset.idx}"]`);
      addToCraftList(r.item.id, r.tier, r.ench, qtyInput.value);
      qtyInput.value = '';
    });
  });
}

/* =======================================================================
   PAGE 4: ルート提案 — 買う都市→作る都市→売る都市の組み合わせを推奨
======================================================================= */
let routeSelectedItem = null;

function renderRoutePage(){
  const tierSel = document.getElementById('routeTier');
  const enchSel = document.getElementById('routeEnch');
  if(!tierSel.dataset.filled){
    tierSel.innerHTML = TIERS4to8.map(t=>`<option value="${t}">T${t}</option>`).join('');
    enchSel.innerHTML = ENCH.map(e=>`<option value="${e}">.${e}</option>`).join('');
    tierSel.value = STATE.settings.tier;
    enchSel.value = STATE.settings.ench;
    tierSel.dataset.filled = '1';
    tierSel.addEventListener('change', ()=>{ if(routeSelectedItem) computeAndRenderRoutes(); });
    enchSel.addEventListener('change', ()=>{ if(routeSelectedItem) computeAndRenderRoutes(); });
    document.getElementById('routeQty').addEventListener('change', ()=>{ if(routeSelectedItem) computeAndRenderRoutes(); });
    document.getElementById('routeBudget').addEventListener('change', ()=>{ if(routeSelectedItem) computeAndRenderRoutes(); });
    document.getElementById('routeIncludeCaerleon').addEventListener('change', ()=>{ if(routeSelectedItem) computeAndRenderRoutes(); });
  }

  renderCategorySidebar('route', document.getElementById('routeCategoryList'), renderRoutePage);

  const search = document.getElementById('routeSearch');
  search.value = pickerUIState.searchTerm.route;
  search.oninput = (e)=>{ pickerUIState.searchTerm.route = e.target.value.trim().toLowerCase(); renderRoutePage(); };

  renderItemPicker('route', document.getElementById('routeItemList'), (item)=>{
    const row = document.createElement('div');
    row.className = 'itemrow';
    const selected = routeSelectedItem && routeSelectedItem.id===item.id;
    row.innerHTML = `
      <img src="${item.file}" alt="${item.name}">
      <div class="irname">${item.name}${isArtifactItem(item)?'<span class="tag-artifact">Artifact</span>':''}</div>
      <button type="button" class="tinybtn routepickbtn">${selected?'選択中':'この装備で計算'}</button>
    `;
    row.querySelector('.routepickbtn').addEventListener('click', ()=>{
      routeSelectedItem = item;
      computeAndRenderRoutes();
    });
    return row;
  });

  if(routeSelectedItem) computeAndRenderRoutes();
}

function computeAndRenderRoutes(){
  const wrap = document.getElementById('routeResultPanel');
  if(!routeSelectedItem){ wrap.innerHTML=''; return; }

  const tier = Number(document.getElementById('routeTier').value);
  const ench = Number(document.getElementById('routeEnch').value);
  const qty = Math.max(1, Number(document.getElementById('routeQty').value)||1);
  const budget = Number(document.getElementById('routeBudget').value)||0;
  const includeCaerleon = document.getElementById('routeIncludeCaerleon').checked;

  const results = recommendRoutes(routeSelectedItem, tier, ench, qty, {
    budget: budget>0 ? budget : Infinity,
    maxRiskTier: includeCaerleon ? RISK.CAERLEON : RISK.ROYAL,
    includeCaerleon,
  });

  if(results.length===0){
    wrap.innerHTML = `<div class="empty-hint">条件に合うルートが見つかりません。売値・素材価格が都市ごとに入力されているか確認してください（「原価入力」タブで各都市の価格を入力すると候補が増えます）。</div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="card">
      <h3>${routeSelectedItem.name} T${tier}.${ench} × ${qty} のおすすめルート</h3>
      <div class="sub">利益/時間が高い順（上位10件）。距離はロイヤル都市の環状マップに基づく概算です。</div>
      <div class="routerows">
        ${results.map((r,idx)=>`
          <div class="routerow">
            <span class="rerank">${idx+1}</span>
            <div class="routepath">
              <span class="rp-city">${CITY_LABELS_JA[r.buyCity]}</span>
              <span class="rp-arrow">買う→</span>
              <span class="rp-city ${r.cost.cityBonus?'rp-bonus':''}">${CITY_LABELS_JA[r.craftCity]}${r.cost.cityBonus?' 🏙':''}</span>
              <span class="rp-arrow">作る→</span>
              <span class="rp-city">${CITY_LABELS_JA[r.sellCity]}</span>
              <span class="rp-arrow">売る</span>
              ${r.riskTier>0 ? '<span class="citybadge citybadge-miss" style="margin-left:8px;">⚠ カエルレオン経由</span>' : ''}
            </div>
            <div class="bstat"><span class="bk">原価</span><span class="bv">${fmt(r.materialCost)}</span></div>
            <div class="bstat"><span class="bk">売値</span><span class="bv">${fmt(r.sellPrice*1)}</span></div>
            <div class="bstat"><span class="bk">利益</span><span class="bv ${r.profit>=0?'profit-pos':'profit-neg'}">${r.profit>=0?'+':''}${fmt(r.profit)}</span></div>
            <div class="bstat"><span class="bk">概算所要時間</span><span class="bv">${(0.25*r.legs+0.15).toFixed(2)}h</span></div>
            <div class="bstat"><span class="bk">利益/時間</span><span class="bv strong ${r.profitPerHour>=0?'profit-pos':'profit-neg'}">${fmt(r.profitPerHour)}/h</span></div>
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
  const entries = Object.keys(STATE.craftList)
    .map(key=>{
      const entry = STATE.craftList[key];
      return {entry, item: ITEMS.find(i=>i.id===entry.itemId)};
    })
    .filter(e=>e.item && e.entry.qty>0);

  if(entries.length===0){ el.textContent='—'; return; }

  let totalProfit = 0, any = false;
  entries.forEach(({item, entry})=>{
    const p = computeProfit(item, entry.tier, entry.ench);
    if(p.sellPrice>0){ totalProfit += p.profit*entry.qty; any = true; }
  });
  if(!any){ el.textContent='—'; return; }
  el.textContent = (totalProfit>=0?'+':'') + fmt(totalProfit) + ' silver';
  el.style.color = totalProfit>=0 ? 'var(--green)' : 'var(--red)';
}

/* =======================================================================
   Init
======================================================================= */
renderPriceCitySelector();
buildRefinedGrid();
renderEquipPricePage();
renderBonusPage();
renderInventoryPage();
renderBuildPage();
renderRecoPage();
updateTopProfit();
