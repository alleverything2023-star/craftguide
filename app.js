/* ==========================================================================
   Albion 装備クラフト原価計算ツール
   ========================================================================== */

/* ---------------------------------------------------------------------
   グローバルエラー表示（タブレット等、開発者ツール(F12)のコンソールを開けない
   端末向け）。JSの実行時エラー・Promiseの未処理rejectionを画面下部に
   常時表示し、発生日時・エラーメッセージ・発生箇所（ファイル:行:列）を
   そのまま表示する。これにより「何かおかしいが原因が分からない」状態を防ぐ。
--------------------------------------------------------------------- */
(function initGlobalErrorBanner(){
  let entries = [];
  function render(){
    const banner = document.getElementById('globalErrorBanner');
    const list = document.getElementById('globalErrorBannerList');
    if(!banner || !list) return; // banner要素が無いページでは何もしない
    if(entries.length===0){ banner.style.display='none'; return; }
    banner.style.display='block';
    list.innerHTML = entries.slice(0,20).map(e=>`
      <div style="margin-bottom:6px; padding-bottom:6px; border-bottom:1px solid rgba(255,255,255,.2);">
        <div>[${e.time}] <b>${e.kind}</b></div>
        <div style="word-break:break-all;">${e.message}</div>
        ${e.where ? `<div style="opacity:.7;">${e.where}</div>` : ''}
      </div>`).join('');
  }
  function push(kind, message, where){
    entries.unshift({time: new Date().toLocaleTimeString('ja-JP'), kind, message: String(message), where});
    if(entries.length>20) entries.length = 20;
    render();
  }
  window.addEventListener('error', ev=>{
    const where = ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : '';
    push('JSエラー', ev.message || (ev.error && ev.error.message) || String(ev), where);
  });
  window.addEventListener('unhandledrejection', ev=>{
    const reason = ev.reason;
    const message = (reason && reason.message) ? reason.message : String(reason);
    push('未処理のPromiseエラー', message, '');
  });
  document.addEventListener('DOMContentLoaded', ()=>{
    const closeBtn = document.getElementById('globalErrorBannerClose');
    if(closeBtn) closeBtn.addEventListener('click', ()=>{ entries = []; render(); });
  });
})();

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

// アーティファクト（欠片）が不要な装備を先に、必要な装備を後に並べ替える。
// 装備入力（価格グリッド・作成リスト等のアイテム一覧）で、まず揃えやすい通常装備から
// 目を通せるようにするための並び替え。
function sortByArtifactNeed(items){
  return [...items].sort((a,b)=> (isArtifactItem(a)?1:0) - (isArtifactItem(b)?1:0));
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

// 🧭 カーナビ機能用：ロイヤル大陸マップ画像（images/map/albion-royal-map.jpg、800x450）上での
// 各都市の旗の位置（%指定）。画像にグリッドを重ねて実測した座標を基準にしている。
const CITY_MAP_COORDS = {
  Thetford:     {x:37.5,  y:19.6},  // 紫（沼地・北西）
  FortSterling: {x:61.25, y:26.2},  // 白（雪山・北）
  Martlock:     {x:25,    y:38.2},  // 青（高地・西）
  Caerleon:     {x:50,    y:45.6},  // 赤黒（中央）
  Lymhurst:     {x:78.1,  y:48.4},  // 緑（森林・東）
  Bridgewatch:  {x:44.4,  y:66.0},  // 橙（砂漠・南）
};

// 各都市のテーマカラー（ゲーム内の旗の色に準拠）。ボーナス都市を装備入力カードの縁の色で
// ひと目で分かるようにするために使う。
const CITY_COLORS = {
  Thetford:     '#a855f7', // 紫（沼地）
  FortSterling: '#e5e7eb', // 白（雪山）
  Martlock:     '#5b9dff', // 青（高地）
  Caerleon:     '#ef4444', // 赤（中央・カエルレオン）
  Lymhurst:     '#4ade80', // 緑（森林）
  Bridgewatch:  '#f0a930', // 橙（砂漠）
};

// 価格入力（精製素材・装備売値・アーティファクトで共有）で選べる都市。
// これは下のBM_LOCATION定義後に組み立てる（このファイル末尾付近で初期化）。
let PRICE_ENTRY_CITIES = CITIES; // ← BM_LOCATION定義後に [...CITIES, BM_LOCATION] へ再設定される

/* ---------------------------------------------------------------------
   ブラックマーケット（カエルレオン内のNPC買取所）
   ・通常都市の「売値」とは別の売却先として扱う（getSellPrice/setSellPriceの
     city引数にこの定数を渡すだけで、既存の都市別売値の仕組みをそのまま流用できる）。
   ・BMは「既存の買い注文を即座に埋める」形でしか売れない前提とする（自分で売り注文を
     出す運用は考慮しない）ため、出品手数料(2.5%)は発生せず、取引税（プレミアム4%/なし8%）
     のみが差し引かれる（computeNetSellのisBlackMarketオプションで分岐）。
   ・地理的にはカエルレオンにあるため、移動距離・危険度（Risk）の計算ではカエルレオンと
     同一都市として扱う（ringDistance/routeRiskの呼び出し側でCaerleonに読み替える）。
   ・AODPの公開APIはBM分の相場も提供しているが、ロケーション名の表記はAODP側の仕様変更で
     変わる可能性がある。取得に失敗する場合は下のAODP_BM_LOCATIONを 'Black Market'（半角スペース
     あり）等に変更して試してください。
--------------------------------------------------------------------- */
const BM_LOCATION = 'BlackMarket';       // このツール内部でのキー（storage key・都市セレクタの値）
const AODP_BM_LOCATION = 'BlackMarket';  // AODPへの問い合わせに使うロケーション名（要検証）
const BM_LABEL_JA = 'ブラックマーケット';

// 価格入力の都市セレクタ（都市の並びの末尾にブラックマーケットを1つのタブとして並べる）。
// 装備売値の入力欄を「都市ごとの売値」と「BM売値」で別々の場所に分けず、同じ並びの中で
// タブを切り替えるだけで済むようにするため。
PRICE_ENTRY_CITIES = [...CITIES, BM_LOCATION];
CITY_LABELS_JA[BM_LOCATION] = BM_LABEL_JA;


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
const LS_KEY = 'albion_calc_state_v14';

function defaultSettings(){
  return {
    tier:4, ench:0,               // 作成リストで実際に作るティア・補正段階
    craftingCity:'Lymhurst',      // どの都市のステーションでクラフトするか（ボーナス都市判定に使用）。
    buyingCity:'Lymhurst',        // 素材・アーティファクトをどの都市で買うか（原価計算に使用）。
                                   // ※ この2つは「作成リスト」「おすすめ」タブが原価を計算する際に参照する固定の都市。
                                   //   価格入力タブでの選択都市（priceEntryCity、既定値はLymhurst）と一致していないと、
                                   //   その都市に価格を入力していても原価が0円（＝利益率が税率分だけの見せかけの高数値）に
                                   //   なってしまうため、既定値をpriceEntryCityと揃えてLymhurstにしている
                                   //  （旧デフォルトは'Martlock'だったが、価格入力の既定タブがLymhurstに変わったことで
                                   //    このズレが原価0円の不具合として表面化していた）。
    sellingCity:BM_LOCATION,      // どの都市で売るか（売値の参照・利益計算に使用）。
                                   // メインの利益源はブラックマーケットのため既定値をBM固定にしている
                                   // （旧デフォルトは'Caerleon'だったが、これはBM_LOCATIONとは別キーのため、
                                   //   BM売値しか入力していない運用だと「おすすめ」等が常に0件になってしまう不具合があった）。
    destinationCity:'Lymhurst',   // 【カーナビ機能】クラフト輸送ルートの最終目的地（Caerleon搬入前のスタッシュ・準備都市）。既定値はLymhurst固定だが、UIから変更可能。
    focus:false,                  // フォーカス使用（還元率+59%）
    saleType:'quick', premium:true,
    aodpFreshnessMinutes:30,      // AODPから取得したデータのうち、この分数より古いものは自動反映しない（鮮度フィルタ）
  };
}

function defaultState(){
  return {
    prices:{},          // prices["plank_T4_1"] = 1234 （都市未指定時のフォールバック価格）
    artifactPrices:{},  // artifactPrices["itemId_T6"] = 5000 （同上フォールバック）
    sellPrices:{},      // sellPrices["itemId_T4_0"] = 45000 （同上フォールバック）
    cityPrices:{},         // cityPrices["Thetford:plank_T4_1"] = 1234 （都市別の素材価格）
    cityArtifactPrices:{},// cityArtifactPrices["Thetford:itemId_T6"] = 5000 （都市別のアーティファクト価格）
    citySellPrices:{},     // citySellPrices["Caerleon:itemId_T4_0"] = 45000 （都市別の売値。BM_LOCATIONも同じ形式で入る）
    inventory:{},           // inventory["Martlock:plank_T4_1"] = 320 （都市の倉庫にある素材の在庫数）
    aodpMapping:{},          // aodpMapping["itemId"] = "T4_HEAD_PLATE_SET1" （AODPのアイテムID。実データベースから選択式で登録）
    aodpMappingNames:{},      // aodpMappingNames["itemId"] = "Soldier Helmet" （確認用の英語名。表示のみに使用）
    bonusSubtypes:{},    // bonusSubtypes["weapon::sword"] = 10 | 20 （その日の日替わり生産ボーナスは"武器種"単位で付与される）
    bonusHistory:{},     // bonusHistory["2026-08-09"] = {"weapon::sword":10, "head::plate":20} （日付ごとのボーナス対象の記録。傾向分析タブで使用。
                          //  公式・AODPともに「日替わりボーナス対象」を直接返すAPIは無いため、このツールを使うたびに実績として記録し、
                          //  それを学習データとして使う方式にしている＝固定スケジュールテーブルではない）
    stationFeeBase:0,   // ステーション使用料：T4.0時点の基準額。ティア+エンチャントの合計が1上がるごとに倍になる
    settings: defaultSettings(),
    craftList:{},        // craftList["itemId_T{tier}_{ench}"] = {itemId,tier,ench,qty}
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(raw){
      const data = JSON.parse(raw);
      const merged = Object.assign(defaultState(), data);
      // settings はオブジェクトごと上書きされてしまうため、新規追加された設定項目
      // （destinationCity等）は個別にデフォルト値でマージし直す（既存の保存値は優先）。
      merged.settings = Object.assign(defaultSettings(), data.settings || {});
      // 旧デフォルト値だった sellingCity:'Caerleon' は BM_LOCATION（'BlackMarket'）とは別キーのため、
      // ブラックマーケット売値しか入力していない運用だと「おすすめ」等が常に0件になってしまう不具合があった。
      // 既存データがこの旧デフォルト値のままの場合は、新デフォルトのBM固定に自動で寄せる
      // （ユーザーが意図的に「カエルレオン（通常都市）」を選び直していた場合は上書きしない…が、
      //   通常都市としてのCaerleonは売却先候補として実質使われていないため、実害はない）。
      if(merged.settings.sellingCity === 'Caerleon'){
        merged.settings.sellingCity = BM_LOCATION;
      }
      // 同様に、craftingCity/buyingCityの旧デフォルト値'Martlock'のままだと、価格入力の既定タブ
      // （priceEntryCity、既定値Lymhurst）とズレて「作成リスト」「おすすめ」の原価が常に0円になる
      // 不具合があったため、両方とも旧デフォルト値のままの場合は新デフォルトのLymhurstに自動で寄せる。
      if(merged.settings.craftingCity === 'Martlock' && merged.settings.buyingCity === 'Martlock'){
        merged.settings.craftingCity = 'Lymhurst';
        merged.settings.buyingCity = 'Lymhurst';
      }
      return merged;
    }
  }catch(e){}

  // v13（ブラックマーケット対応・AODP鮮度フィルタ・ボーナス履歴ログを追加する前のバージョン）からの移行
  // ※ 既存データはすべてそのまま引き継ぎ、新規フィールド（bonusHistory・aodpFreshnessMinutes）だけ補う。
  try{
    const oldRaw = localStorage.getItem('albion_calc_state_v13');
    if(oldRaw){
      const old = JSON.parse(oldRaw);
      const s = defaultState();
      Object.assign(s, old);
      s.bonusHistory = old.bonusHistory || {};
      s.settings = Object.assign(defaultSettings(), old.settings || {});
      return s;
    }
  }catch(e){}

  // v12（フリー入力のAODPコード欄があった旧バージョン）からの移行
  // ※ フリー入力のコードはタイポの可能性があるため、あえて引き継がず、
  //   選択式UIで登録し直してもらう（安全のためのリセット）。
  try{
    const oldRaw = localStorage.getItem('albion_calc_state_v12');
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
   ここでは「販売数分析」タブの出来高（何個売れているか）の推定にのみ使う。
   価格（原価・売値）はユーザー自身が入力する方針のため、AODPから価格を
   自動取得して原価入力欄へ書き込む機能は持たない。
--------------------------------------------------------------------- */
const AODP_SERVERS = {
  west:   'https://west.albion-online-data.com',
  east:   'https://east.albion-online-data.com',
  europe: 'https://europe.albion-online-data.com',
};
let aodpServer = 'east'; // デフォルトはアジアサーバー（Albion East / Singapore）

/* ---------------------------------------------------------------------
   通信エラーの可視化ログ
   AODPとの通信（fetch）で失敗が起きても、これまでは catch で握りつぶして
   「おすすめ製造個数」が既定値の5個にフォールバックするだけで、原因が
   画面上には一切表示されていなかった（開発者ツール(F12)のコンソール/Networkタブを
   見ないと分からない）。タブレット等コンソールを開けない端末でも原因が分かるよう、
   発生したエラーをここに記録し、UI上（販売数分析タブなど）に表示する。
--------------------------------------------------------------------- */
const AODP_ERROR_LOG = [];        // {ts, context, message}
const AODP_ERROR_LOG_MAX = 40;    // 直近N件だけ保持
function logAodpError(context, err){
  const message = (err && err.message) ? String(err.message) : String(err);
  AODP_ERROR_LOG.unshift({ts: Date.now(), context: String(context), message});
  if(AODP_ERROR_LOG.length > AODP_ERROR_LOG_MAX) AODP_ERROR_LOG.length = AODP_ERROR_LOG_MAX;
}
function clearAodpErrorLog(){ AODP_ERROR_LOG.length = 0; }
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// 直近のエラーをメッセージ内容でグルーピングし、件数の多い順に並べる（同じ原因を何十行も出さないため）
function summarizeAodpErrors(){
  const groups = {};
  AODP_ERROR_LOG.forEach(e=>{
    if(!groups[e.message]) groups[e.message] = {message:e.message, count:0, lastTs:0, sampleContext:e.context};
    groups[e.message].count++;
    if(e.ts > groups[e.message].lastTs){ groups[e.message].lastTs = e.ts; groups[e.message].sampleContext = e.context; }
  });
  return Object.values(groups).sort((a,b)=>b.count-a.count);
}
// AODPエラーの警告バナーHTML（エラーが無ければ空文字）。
// 「おすすめ製造個数」が5個ばかりになる不具合の主原因はほぼ確実にこの通信エラーのため、
// 実際に起きたエラーメッセージをそのまま画面に出す（F12が開けないタブレットでも原因が分かるように）。
function renderAodpErrorBanner(){
  if(AODP_ERROR_LOG.length===0) return '';
  const summary = summarizeAodpErrors();
  const rows = summary.slice(0,6).map(g=>{
    const t = new Date(g.lastTs).toLocaleTimeString('ja-JP');
    return `<div style="margin-top:4px;">・<code>${escapeHtml(g.message)}</code>　(${g.count}件／例: ${escapeHtml(g.sampleContext)}／最終発生 ${t})</div>`;
  }).join('');
  return `
    <div class="note" style="margin-bottom:6px; border:1px solid var(--red,#c0392b);">
      ⚠ AODP（Albion Online Data Project）との通信で以下のエラーが発生しています。
      「おすすめ製造個数」が全て既定値の5個になっている場合、ほぼこれが原因です。<br>
      ${rows}
      <div style="margin-top:6px;">
        よくある原因：①タブレットのブラウザ/ネットワークが east.albion-online-data.com 等への接続をブロックしている（広告・トラッキングブロッカー、機内モード的な通信制限、学校・会社のネット規制など）
        ②AODPサーバー側が一時的にダウンしている　③選択中のサーバー（東/西/欧州）が実際のプレイサーバーと合っていない。<br>
        まずは画面上部の「サーバー」選択が合っているか確認し、Wi-Fi⇔モバイル回線の切り替えや別ブラウザでの再試行をお試しください。
      </div>
    </div>`;
}

// AODP接続テスト：コンソール(F12)が開けないタブレット等でも原因が分かるよう、
// 3サーバーそれぞれに実際にfetchしてみて、成功/失敗と生のエラー内容をそのまま画面に表示する。
// 軽量な /api/v2/stats/prices エンドポイント（既知アイテム1件）を使い、通信そのものの可否を確認する。
async function runAodpConnectivityTest(resultEl){
  resultEl.innerHTML = `<div class="empty-hint">接続テスト中…</div>`;
  const testItemId = 'T4_BAG'; // 常に存在する低ティア汎用アイテムでテスト
  const rows = await Promise.all(Object.entries(AODP_SERVERS).map(async ([key, base])=>{
    const url = `${base}/api/v2/stats/prices/${testItemId}.json?locations=Caerleon`;
    const t0 = performance.now();
    try{
      const res = await fetch(url);
      const ms = Math.round(performance.now()-t0);
      if(!res.ok){
        return {key, base, ok:false, ms, detail:`HTTP ${res.status} ${res.statusText}`};
      }
      const data = await res.json();
      return {key, base, ok:true, ms, detail:`OK（${Array.isArray(data)?data.length:0}件のデータを受信）`};
    }catch(err){
      const ms = Math.round(performance.now()-t0);
      // fetch自体が失敗する場合、ブラウザは詳細な理由を教えてくれないことが多いが、
      // 典型的には「オフライン」「CORSブロック」「広告/トラッキングブロッカーによる遮断」「DNS失敗」等。
      return {key, base, ok:false, ms, detail: `${err.name}: ${err.message}`};
    }
  }));

  const anyOk = rows.some(r=>r.ok);
  const currentOk = rows.find(r=>r.key===aodpServer && r.ok);
  const rowsHtml = rows.map(r=>`
    <div class="routerow">
      <span class="rerank">${r.ok?'✅':'❌'}</span>
      <div class="bstat"><span class="bk">${r.key}${r.key===aodpServer?'（現在選択中）':''}</span><span class="bv" style="font-size:12px;">${r.base}</span></div>
      <div class="bstat"><span class="bk">結果</span><span class="bv strong ${r.ok?'profit-pos':'profit-neg'}">${escapeHtml(r.detail)}</span></div>
      <div class="bstat"><span class="bk">応答時間</span><span class="bv">${r.ms}ms</span></div>
    </div>`).join('');

  let summary;
  if(!anyOk){
    summary = `❌ 3サーバーすべてに接続できませんでした。この端末（またはこのネットワーク）からalbion-online-data.comへの通信がブロックされている可能性が高いです。
      Wi-Fi⇔モバイル回線の切り替え、VPN/広告ブロッカーの無効化、別ブラウザでの再試行をお試しください。`;
  }else if(!currentOk){
    summary = `⚠ 現在選択中のサーバー「${aodpServer}」には接続できませんでしたが、他のサーバーには接続できました。画面上部の「サーバー」選択を、実際にプレイしているサーバーに合わせて変更してください。`;
  }else{
    summary = `✅ 現在選択中のサーバー「${aodpServer}」への接続は正常です。それでも「おすすめ製造個数」が5個ばかりになる場合は、対象の装備がAODPにリンクされていないか、その装備自体の出来高データが無い可能性があります。`;
  }

  resultEl.innerHTML = `
    <div class="note" style="margin-bottom:6px;">${summary}</div>
    <div class="routerows">${rowsHtml}</div>
  `;
}

function getAodpCode(itemId){
  return STATE.aodpMapping[itemId] || '';
}
function setAodpCode(itemId, code, name){
  code = (code||'').trim().toUpperCase();
  if(!code){
    delete STATE.aodpMapping[itemId];
    delete STATE.aodpMappingNames[itemId];
  }else{
    STATE.aodpMapping[itemId] = code;
    if(name) STATE.aodpMappingNames[itemId] = name;
  }
  saveState();
}
function getAodpEnglishName(itemId){
  return STATE.aodpMappingNames ? (STATE.aodpMappingNames[itemId]||'') : '';
}
// 現在AODPにリンク済みの装備が何件あるかを数える。
// 「おすすめ製造個数」が常に5個になる原因の多くは、通信エラーではなく
// そもそも装備が1件もAODPにリンクされていないことなので、ボタンを押さなくても
// 常に見える場所にこの件数を出すことで気づきやすくする。
function countAodpLinkedItems(){
  return Object.keys(STATE.aodpMapping || {}).filter(id => STATE.aodpMapping[id]).length;
}
function renderAodpLinkStatusBanner(){
  const linked = countAodpLinkedItems();
  const total = ITEMS.length;
  if(linked===0){
    return `<div class="note" style="margin-bottom:10px; border:1px solid var(--red,#c0392b);">
      ⚠ 現在、AODPにリンクされている装備が<b>0件</b>です。装備がAODPにリンクされていないと通信自体が発生せず、
      「おすすめ製造個数」は全て既定値の<b>5個</b>になります（この場合エラーは出ません＝正常な動作です）。<br>
      「原価入力 &gt; 装備売値・アーティファクト」タブを開き、各装備の <b>英語名検索</b> から候補を選んでリンクしてください。
      リンクした装備だけがAODPの実データ（出来高）を使った推定に切り替わります。
    </div>`;
  }
  return `<div class="note" style="margin-bottom:10px;">ℹ 現在 <b>${linked}/${total}件</b> の装備がAODPにリンク済みです。リンクされていない装備は既定値の5個のままになります。</div>`;
}

/* ---------------------------------------------------------------------
   AODPアイテムID検索（タイポ防止のための選択式UI用データソース）
   ao-bin-dumps（Albion Onlineのゲームデータから機械的に抽出された実データ、約16MB）を
   初回利用時にのみブラウザが直接取得し、英語名で検索→クリックで選ぶ方式にすることで、
   手入力によるタイポ・404エラーを防ぐ。取得したデータはこのセッション中のみメモリに保持する
   （容量が大きいためlocalStorageには保存しない＝ページを再読み込みすると再取得が必要）。
--------------------------------------------------------------------- */
const AODP_ITEM_DB_URL = 'https://raw.githubusercontent.com/broderickhyman/ao-bin-dumps/master/formatted/items.json';
let aodpItemIndex = null;      // [{id:'T4_HEAD_PLATE_SET1', name:'Soldier Helmet'}, ...]
let aodpItemIndexPromise = null;

async function ensureAODPItemIndex(statusCb){
  if(aodpItemIndex) return aodpItemIndex;
  if(aodpItemIndexPromise) return aodpItemIndexPromise;

  aodpItemIndexPromise = (async ()=>{
    if(statusCb) statusCb('アイテムデータベースを取得中…（初回のみ・16MBほどあるため数秒〜数十秒かかります）');
    const res = await fetch(AODP_ITEM_DB_URL);
    if(!res.ok) throw new Error('データベース取得失敗: HTTP '+res.status);
    const raw = await res.json();
    if(statusCb) statusCb('アイテム名を解析中…');

    // ao-bin-dumpsの形式は更新でフィールド名が変わることがあるため、複数パターンを試す
    const list = Array.isArray(raw) ? raw : (raw.items || Object.values(raw));
    const index = [];
    list.forEach(entry=>{
      if(!entry) return;
      const uniqueName = entry.UniqueName || entry.uniqueName || entry.Index || entry.id;
      if(!uniqueName || typeof uniqueName !== 'string') return;
      const localized = entry.LocalizedNames || entry.localizedNames || {};
      const enName = localized['EN-US'] || localized['en-US'] || localized.EN || entry.EnglishItemName || entry.name;
      if(!enName) return;
      index.push({id: uniqueName, name: enName});
    });

    if(index.length===0) throw new Error('データの形式を認識できませんでした（サイト側の形式変更の可能性があります）');
    aodpItemIndex = index;
    if(statusCb) statusCb(`読み込み完了（${index.length}件）`);
    return aodpItemIndex;
  })();

  try{
    return await aodpItemIndexPromise;
  }catch(err){
    aodpItemIndexPromise = null; // 失敗時は次回また取得を試せるようにする
    throw err;
  }
}

function searchAODPItemIndex(query, limit=15){
  if(!aodpItemIndex || !query) return [];
  const q = query.trim().toLowerCase();
  if(!q) return [];
  return aodpItemIndex
    .filter(e => e.name.toLowerCase().includes(q))
    .slice(0, limit);
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
// ゲーム内のデイリーボーナス切り替え時刻は「UTC 0:00（日本時間 9:00）」。
// これはカレンダー上のUTC日付境界そのものと一致するため、UTCの日付フィールドを
// そのまま「ゲーム内のボーナス日」として扱えばよい（それより前は独自オフセットで
// 巻き戻していたが、UTC 0:00基準になったことでオフセットは不要＝0時間になった）。
const BONUS_RESET_UTC_HOUR = 0; // UTC 0:00 = JST 9:00
function getBonusGameDate(now){
  const base = now instanceof Date ? now : new Date();
  const shifted = new Date(base.getTime() - BONUS_RESET_UTC_HOUR*60*60*1000);
  // ローカルタイムゾーンの影響を受けないよう、UTCのフィールドだけで日付キーを組み立てる
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}
// 「ゲーム内のボーナス日」の日付キー（YYYY-MM-DD、UTC 0:00 / 日本時間9:00 切り替え基準）
function todayKey(now){
  const d = getBonusGameDate(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
function setBonusForSubtype(category, subtype, val){
  const key = subtypeKey(category, subtype);
  if(!val){ delete STATE.bonusSubtypes[key]; }
  else STATE.bonusSubtypes[key] = val;

  // ボーナス設定を「実績」として日付ごとに記録しておく（傾向分析タブで使用）。
  // 公式・AODPともに日替わりボーナス対象を直接返すAPIは無いため、固定スケジュールではなく
  // ツールを使うたびに蓄積される実績ログとして扱う。
  const dKey = todayKey();
  if(!STATE.bonusHistory[dKey]) STATE.bonusHistory[dKey] = {};
  if(!val){ delete STATE.bonusHistory[dKey][key]; }
  else STATE.bonusHistory[dKey][key] = val;
  if(Object.keys(STATE.bonusHistory[dKey]).length===0) delete STATE.bonusHistory[dKey];

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

function computeNetSell(sellPrice, opts={}){
  const s = STATE.settings;
  const isBM = !!opts.isBlackMarket;
  const taxRate = s.premium ? 4 : 8; // プレミアムなら4%、非プレミアムなら8%
  // ブラックマーケットは「既存の買い注文を即座に埋める」形の売却のみを想定するため、
  // 出品手数料(2.5%)は発生せず、取引税のみが引かれる（自分でBMに売り注文を出す運用は非対応）。
  const setupRate = (!isBM && s.saleType === 'order') ? SETUP_FEE_RATE : 0;
  const setupFee = sellPrice * (setupRate/100);
  const tax = sellPrice * (taxRate/100) + setupFee;
  const net = sellPrice - tax;
  return {taxRate, setupRate, setupFee, tax, net, isBlackMarket: isBM};
}

function computeProfit(item, tier, ench, sellingCity){
  const s = STATE.settings;
  sellingCity = sellingCity || s.sellingCity;
  const cost = computeItemCost(item, tier, ench);
  const sellPrice = getSellPrice(sellingCity, item.id, tier, ench);
  const {net, tax} = computeNetSell(sellPrice, {isBlackMarket: sellingCity===BM_LOCATION});
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

/* ---------------------------------------------------------------------
   AODP: 直近の出来高・価格推移（流動性・安定性の分析用）
   /stats/charts エンドポイント（日次バケット）から直近N日分を取り出し、
   平均出来高・平均価格・価格変動係数（安定性）・トレンド（直近の伸び率）を算出する。
--------------------------------------------------------------------- */
// 内部の都市/BMキーをAODPへの問い合わせ用のロケーション名に変換する
function toAodpLocationParam(loc){
  return loc === BM_LOCATION ? AODP_BM_LOCATION : loc;
}

// ブラックマーケットのロケーション表記はAODP側で 'BlackMarket' / 'Black Market'（半角スペースあり）
// など複数パターンが確認されており、どちらが有効かはサーバー・時期によって変わりうる。
// 「おすすめ製造個数」が常に既定値（5個）にしかならない場合、多くはここが原因（表記が合わず
// 出来高0件のまま返ってきている）。候補を順番に試し、データが取れた表記をキャッシュして使い回す。
const AODP_LOCATION_CANDIDATES = {
  [BM_LOCATION]: ['BlackMarket', 'Black Market'],
};
const resolvedAodpLocationCache = {}; // loc -> 実際にデータが取れた表記（デバッグ表示にも使う）

async function fetchAODPChartRaw(id, locationParam, days){
  const base = AODP_SERVERS[aodpServer];
  const url = `${base}/api/v2/stats/charts/${id}.json?locations=${encodeURIComponent(locationParam)}&time-scale=24&date=${daysAgoDateStr(days)}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('AODP chart request failed: HTTP '+res.status);
  const data = await res.json();
  return (data[0] && data[0].data) || [];
}

// locに対応するAODPロケーション表記の候補を順番に試し、データが取れた表記を返す（以後はキャッシュを再利用）。
async function fetchAODPChartWithLocationFallback(id, loc, days){
  if(resolvedAodpLocationCache[loc]){
    return {raw: await fetchAODPChartRaw(id, resolvedAodpLocationCache[loc], days), locationParam: resolvedAodpLocationCache[loc]};
  }
  const candidates = AODP_LOCATION_CANDIDATES[loc] || [toAodpLocationParam(loc)];
  let lastErr = null;
  for(const cand of candidates){
    try{
      const raw = await fetchAODPChartRaw(id, cand, days);
      if(raw.length>0){
        resolvedAodpLocationCache[loc] = cand; // 当たった表記を記憶し、次回以降は1回の問い合わせで済ませる
        return {raw, locationParam: cand};
      }
    }catch(err){ lastErr = err; logAodpError(`${loc}（表記候補:${cand}）`, err); }
  }
  if(lastErr) throw lastErr; // どの表記でも失敗（HTTPエラー等）した場合のみ例外を投げる
  return {raw: [], locationParam: candidates[0]}; // 全表記で0件＝本当にその期間の出来高が無い
}

async function fetchAODPMarketStats(item, tier, ench, city, days=7){
  const code = getAodpCode(item.id);
  if(!code) return null;
  const m = code.match(/^T\d+_(.+)$/);
  if(!m) return null;
  const id = `T${tier}_${m[1]}` + (ench>0 ? `@${ench}` : '');
  const {raw: points} = await fetchAODPChartWithLocationFallback(id, city, days);
  const recent = points.slice(-days);

  if(recent.length===0) return {city, avgVolume:0, avgPrice:0, volatility:0, trend:0, samples:0};

  const volumes = recent.map(p=>Number(p.item_count)||0);
  const prices = recent.map(p=>Number(p.avg_price)||0).filter(p=>p>0);
  const avgVolume = volumes.reduce((a,b)=>a+b,0) / volumes.length;
  const avgPrice = prices.length ? prices.reduce((a,b)=>a+b,0)/prices.length : 0;
  const variance = prices.length ? prices.reduce((s,p)=>s+Math.pow(p-avgPrice,2),0)/prices.length : 0;
  const volatility = avgPrice>0 ? Math.sqrt(variance)/avgPrice : 0; // 変動係数（小さいほど価格が安定）
  const trend = (prices.length>=2 && prices[0]>0) ? (prices[prices.length-1]-prices[0])/prices[0] : 0; // 期間中の上昇/下落率

  return {city, avgVolume, avgPrice, volatility, trend, samples:recent.length};
}

// 候補となる売却都市すべての市場統計を並行取得し、都市名をキーにしたマップで返す
async function fetchMarketStatsForCities(item, tier, ench, cities, days){
  if(!getAodpCode(item.id)) return {}; // AODPコード未登録なら市場データ無しとして扱う（フィルタは効かせない）
  const entries = await Promise.all(cities.map(async city=>{
    try{ return [city, await fetchAODPMarketStats(item, tier, ench, city, days)]; }
    catch(e){ logAodpError(`${item.name} @ ${city}`, e); return [city, null]; }
  }));
  const map = {};
  entries.forEach(([city, stats])=>{ if(stats) map[city] = stats; });
  return map;
}

/**
 * 【クラフト輸送のカーナビ】item を tier.ench で qty 個作る場合の、買う都市→作る都市の組み合わせを
 * 総当たりで評価し、利益/時間が高い順に上位を返す。
 * ・売却先は常にメインの利益源である「ブラックマーケット（Caerleon）」に固定（BM_LOCATION）。
 * ・ルートの終点（ゴール）は常に opts.destinationCity（既定値: STATE.settings.destinationCity＝Lymhurst）。
 *   BMへの最終搬入（Lymhurst→Caerleon）はこのツールのルート表示には含めない
 *   （最終目的地＝Caerleon搬入前のスタッシュ・準備都市、という運用前提のため）。
 * opts.includeCaerleon が true のときだけ、購入・クラフトをカエルレオンで行う候補も含める（Risk 2）。
 * opts.cityStats: {[BM_LOCATION]: {avgVolume, avgPrice, volatility, trend}} — fetchMarketStatsForCities() の戻り値。
 * opts.minVolume: ブラックマーケットの直近平均出来高（1日あたり）がこれ未満なら除外する（在庫リスク回避）。
 * opts.maxVolatility: 価格変動係数がこれを超える場合は除外する（暴騰/暴落に惑わされないため）。
 * opts.bonusDayDiscount: 対象アイテムの武器種/防具種が本日ボーナス対象の場合、
 *   供給過多で値崩れしやすい前提で売値をこの%だけ割り引いて保守的に見積もる。
 */
function recommendRoutes(item, tier, ench, qty, opts={}){
  const {budget, maxRiskTier, includeCaerleon, cityStats={}, minVolume=0, maxVolatility=null, bonusDayDiscount=0} = opts;
  const destinationCity = opts.destinationCity || STATE.settings.destinationCity || 'Lymhurst';
  const effBudget = budget>0 ? budget : Infinity;
  const effMaxRisk = maxRiskTier!==undefined ? maxRiskTier : RISK.ROYAL;
  const results = [];
  const candidateCities = includeCaerleon ? CITIES : CITY_RING;

  // 売却先（Market）はメインの利益源であるブラックマーケット（Caerleon）に固定。
  const sellCity = BM_LOCATION;

  const isBonusToday = getBonusForSubtype(item.category, item.subtype) > 0;
  const priceDiscountFactor = isBonusToday ? (1 - (Number(bonusDayDiscount)||0)/100) : 1;

  const stats = cityStats[sellCity] || null;
  if(stats){
    if(minVolume>0 && stats.avgVolume < minVolume) return [];       // 流動性フィルタ
    if(maxVolatility!=null && stats.volatility > maxVolatility) return []; // 安定性フィルタ
  }

  const rawSellPrice = getSellPrice(sellCity, item.id, tier, ench);
  if(rawSellPrice<=0) return [];
  const sellPrice = rawSellPrice * priceDiscountFactor; // ボーナスデー割引を反映した保守的な見積もり
  const {net} = computeNetSell(sellPrice, {isBlackMarket:true});

  candidateCities.forEach(buyCity=>{
    candidateCities.forEach(craftCity=>{
      const riskTier = routeRisk([buyCity, craftCity]);
      if(riskTier > effMaxRisk) return;

      const cost = computeItemCost(item, tier, ench, craftCity, buyCity);
      const materialCost = cost.total * qty;
      if(materialCost > effBudget) return;

      const profit = (net - cost.total) * qty;

      // ルート表示（経由地）：購入都市→クラフト都市→最終目的地。連続する同一都市は畳み込む。
      const rawWaypoints = [buyCity, craftCity, destinationCity];
      const waypoints = rawWaypoints.filter((c,i)=>i===0||c!==rawWaypoints[i-1]);

      // 移動時間モデル：購入→クラフト→最終目的地までのリング距離の合計
      // （カエルレオン絡みの区間、およびLymhurst→Caerleonの最終搬入は距離評価から除外＝概算に含めない）
      const legDistBuyCraft = ringDistance(buyCity, craftCity);
      const legDistCraftDest = ringDistance(craftCity, destinationCity);
      const legs = (legDistBuyCraft||0) + (legDistCraftDest||0);
      const estHours = 0.25*legs + 0.15; // 1リング区間=0.25時間 + クラフト等の固定時間0.15時間（目安。実測に合わせて調整可）
      const profitPerHour = profit / estHours;

      results.push({buyCity, craftCity, destinationCity, waypoints, sellCity, isBM:true, cost, materialCost,
                     rawSellPrice, sellPrice, profit, profitPerHour, riskTier, legs, marketStats: stats, isBonusToday});
    });
  });

  return results.sort((a,b)=>b.profitPerHour-a.profitPerHour).slice(0,10);
}

/* =======================================================================
   【カーナビ・コア】相乗りまとめ生産ルート提案
   ---------------------------------------------------------------------
   全アイテムを対象に、各アイテムごとの最適ルート（素材最安都市→利益最大クラフト都市→
   最終目的地）を算出し、同一ルート（RouteKey）ごとにグループ化する。
   同じ移動でまとめて仕入れ・製作できる高利益アイテムを「メイン看板アイテム」＋
   「相乗り推奨アイテム」として提示するための中核関数。
   売却先は常にブラックマーケット（Caerleon）固定。
========================================================================= */
function calculateOptimalCraftRoutes(opts={}){
  const s = STATE.settings;
  const destinationCity = opts.destinationCity || s.destinationCity || 'Lymhurst';
  const includeCaerleon = !!opts.includeCaerleon;
  const candidateCities = includeCaerleon ? CITIES : CITY_RING;
  const sellCity = BM_LOCATION; // 売却先（Market）: Caerleon（Black Market）
  const minProfit = opts.minProfit!=null ? opts.minProfit : 0;
  const tierList = opts.tierList || TIERS4to8;
  const enchList = opts.enchList || ENCH;
  const bundleLimit = opts.bundleLimit || 8;

  const itemBestRoutes = [];

  ITEMS.forEach(item=>{
    let best = null; // このアイテムにとって最も利益が高い (tier, ench, 購入都市, クラフト都市) の組み合わせ

    tierList.forEach(tier=>{
      enchList.forEach(ench=>{
        const rawSellPrice = getSellPrice(sellCity, item.id, tier, ench);
        if(rawSellPrice<=0) return;
        const {net} = computeNetSell(rawSellPrice, {isBlackMarket:true});

        // a. 素材合計購入額が最も安い都市 (MaterialCity) を特定
        //    （精算前の購入総額は購入都市の単価だけで決まり、クラフト都市の還元ボーナスには依存しないため、
        //     ここでは craftingCity=buyingCity として grossTotal のみを比較する）
        let materialCity = null, bestGrossTotal = Infinity;
        candidateCities.forEach(buyCity=>{
          const c = computeItemCost(item, tier, ench, buyCity, buyCity);
          if(c.grossTotal > 0 && c.grossTotal < bestGrossTotal){
            bestGrossTotal = c.grossTotal;
            materialCity = buyCity;
          }
        });
        if(!materialCity) return; // 価格未入力の素材はスキップ

        // b. クラフトボーナス（返却率）と手数料を加味し、利益が最大となるクラフト都市 (CraftCity) を特定
        //    （購入都市は a. で決めた MaterialCity に固定）
        let craftBest = null;
        candidateCities.forEach(craftCity=>{
          const cost = computeItemCost(item, tier, ench, craftCity, materialCity);
          const profit = net - cost.total;
          if(!craftBest || profit > craftBest.profit) craftBest = {craftCity, cost, profit};
        });
        if(!craftBest || craftBest.profit <= minProfit) return;

        const margin = rawSellPrice>0 ? (craftBest.profit/rawSellPrice*100) : 0;
        if(!best || craftBest.profit > best.profit){
          best = {
            item, tier, ench, materialCity, craftCity: craftBest.craftCity,
            cost: craftBest.cost, sellPrice: rawSellPrice, net, profit: craftBest.profit, margin,
          };
        }
      });
    });

    if(best) itemBestRoutes.push(best);
  });

  // c. ルートキー (RouteKey) の生成：購入都市→クラフト都市→最終目的地。連続する同一都市は畳み込む
  //    （例1: "Martlock -> Bridgewatch -> Lymhurst" 例2: "Bridgewatch -> Lymhurst"）
  itemBestRoutes.forEach(r=>{
    const raw = [r.materialCity, r.craftCity, destinationCity];
    r.waypoints = raw.filter((c,i)=> i===0 || c!==raw[i-1]);
    r.routeKey = r.waypoints.join(' -> ');
  });

  // a. 全アイテムを RouteKey ごとにグループ化
  const routesMap = {};
  itemBestRoutes.forEach(r=>{
    (routesMap[r.routeKey] = routesMap[r.routeKey] || []).push(r);
  });

  // b. 各グループ内のアイテムを利益額順にソート
  Object.values(routesMap).forEach(list => list.sort((a,b)=>b.profit-a.profit));

  // c./d. メイン看板アイテムと相乗り推奨アイテムに分離し、ルート評価スコア順に並べる
  const routeList = Object.keys(routesMap).map(routeKey=>{
    const list = routesMap[routeKey];
    const primaryItem = list[0];
    const bundleItems = list.slice(1, 1+bundleLimit);
    const routeScore = [primaryItem, ...bundleItems].reduce((sum,r)=>sum+r.profit, 0);
    return {
      routeKey,
      waypoints: primaryItem.waypoints,
      primaryItem,
      bundleItems,
      otherItemCount: Math.max(0, list.length - 1 - bundleItems.length),
      totalItemsOnRoute: list.length,
      routeScore,
    };
  });

  routeList.sort((a,b)=>b.routeScore-a.routeScore);
  return routeList;
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
    if(page==='trend') renderTrendPage();
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
document.getElementById('aodpServerSelect').value = aodpServer; // 初期表示をJS側のデフォルト（アジアサーバー）に合わせる

/* =======================================================================
   PAGE 1-A: 精製素材 price grid
======================================================================= */
/* =======================================================================
   価格入力の対象都市（精製素材・装備売値・アーティファクトで共有）
======================================================================= */
let priceEntryCity = 'Lymhurst';

function renderPriceCitySelector(){
  const wrap = document.getElementById('priceCityRow');
  if(!wrap) return;
  // 都市の並びの末尾にブラックマーケットも1つのタブとして表示する（PRICE_ENTRY_CITIES = [...CITIES, BM_LOCATION]）。
  wrap.innerHTML = PRICE_ENTRY_CITIES.map(c=>
    `<button type="button" class="citybtn${c===priceEntryCity?' active':''}${c===BM_LOCATION?' citybtn-bm':''}" data-city="${c}">${CITY_LABELS_JA[c]}</button>`
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
  const isBM = priceEntryCity === BM_LOCATION;
  ['refinedGrid','rawGrid'].forEach(id=>{
    const wrap = document.getElementById(id);
    if(wrap && isBM){
      wrap.innerHTML = `<div class="note">${BM_LABEL_JA}では素材を購入できないため、この画面には入力欄がありません。通常都市タブに切り替えて入力してください。</div>`;
    }
  });
  if(isBM) return;
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
    items: sortByArtifactNeed(ITEMS.filter(i=>i.category===equipCategory && i.subtype===sub)),
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
  const isBM = priceEntryCity === BM_LOCATION;
  g.items.forEach(item=>{
    const col = document.createElement('div');
    col.className = 'pricecol equipcol';
    // ボーナス都市が分かるよう、カードの縁をその都市のテーマカラーで着色する
    const bonusCity = getBonusCity(item);
    const bonusColor = bonusCity ? CITY_COLORS[bonusCity] : null;
    if(bonusColor){
      col.style.borderColor = bonusColor;
      col.style.boxShadow = `inset 0 0 0 1px ${bonusColor}55`;
    }
    let html = `<h5><img class="colthumb" src="${item.file}" alt="">${item.name}${isArtifactItem(item)?'<span class="tag-artifact">Artifact</span>':''}</h5>`;
    if(bonusCity){
      html += `<div class="citybonusrow"><span class="citybonusdot" style="background:${bonusColor};"></span>ボーナス都市: ${CITY_LABELS_JA[bonusCity]}</div>`;
    }
    html += renderAodpBlockHtml(item);

    // 売値：都市タブの並びの中に「ブラックマーケット」も1つのタブとして含めているため、
    // 入力欄自体は常にこの1か所だけで、選択中のタブ（priceEntryCity）に応じて
    // 通常都市の売値／BM売値（NPC買取価格）のどちらに保存するかが切り替わる。
    if(isBM && item.category==='cape'){
      html += `<div class="note" style="margin-top:6px;">${BM_LABEL_JA}ではケープは買い取ってもらえないため、入力欄はありません（通常都市タブで売値を入力してください）。</div>`;
    }else{
      const sellLabel = isBM ? `${BM_LABEL_JA}売値（NPC買取価格）` : '売値';
      html += `<div class="prow subtle" style="padding-top:6px;"><label style="font-weight:700;color:${isBM?'var(--gold-soft)':'var(--text-faint)'};">${sellLabel}</label></div>`;
      TIERS4to8.forEach(t=>{
        ENCH.forEach(e=>{
          html += `<div class="prow"><label>T${t}.${e}</label>
            <input type="number" min="0" placeholder="0" data-item="${item.id}" data-tier="${t}" data-ench="${e}"></div>`;
        });
      });
    }

    if(isArtifactItem(item)){
      if(isBM){
        html += `<div class="note" style="margin-top:6px;">アーティファクト欠片は${BM_LABEL_JA}では購入できないため、入力欄はありません（通常都市タブで単価を入力してください）。</div>`;
      }else{
        html += `<div class="prow subtle artifact-subhead"><label>アーティファクト欠片単価</label></div>`;
        TIERS4to8.forEach(t=>{
          html += `<div class="prow"><label>T${t}</label>
            <input type="number" min="0" placeholder="0" class="artifact-input" data-artifact-item="${item.id}" data-artifact-tier="${t}"></div>`;
        });
      }
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

  bindAodpBlockEvents(grid, g.items);
}

/* -----------------------------------------------------------------------
   AODPコードの選択式UI（タイポ防止）
   ・未登録：英語名で検索 → 実データベースの候補をクリックで選択（自由入力不可）
   ・登録済：確定したID＋英語名をチップ表示、「変更」でまた検索モードに戻れる
----------------------------------------------------------------------- */
function renderAodpBlockHtml(item){
  const code = getAodpCode(item.id);
  if(code){
    const enName = getAodpEnglishName(item.id);
    return `<div class="aodpblock" data-aodp-item="${item.id}">
      <div class="aodpchip">
        <span class="aodpchip-id">${code}</span>
        ${enName ? `<span class="aodpchip-name">${enName}</span>` : ''}
        <button type="button" class="tinybtn aodpchangebtn" data-aodp-item="${item.id}">変更</button>
      </div>
      <div class="aodpstatus" data-aodp-status="${item.id}"></div>
    </div>`;
  }
  return `<div class="aodpblock" data-aodp-item="${item.id}">
    <div class="aodprow">
      <input type="text" class="aodpsearch" placeholder="英語名で検索…" data-aodp-item="${item.id}" value="${item.name}">
    </div>
    <div class="aodpresults" data-aodp-results="${item.id}"></div>
    <div class="aodpstatus" data-aodp-status="${item.id}"></div>
  </div>`;
}

function bindAodpBlockEvents(grid, items){
  // 検索欄：入力のたびに候補リストだけを差し替える（列全体は再描画しないのでフォーカスは失われない）
  grid.querySelectorAll('.aodpsearch').forEach(inp=>{
    const itemId = inp.dataset.aodpItem;
    const resultsEl = grid.querySelector(`[data-aodp-results="${CSS.escape(itemId)}"]`);
    const statusEl = grid.querySelector(`[data-aodp-status="${CSS.escape(itemId)}"]`);

    const runSearch = async ()=>{
      if(!aodpItemIndex){
        statusEl.textContent = '';
        try{
          await ensureAODPItemIndex(msg=>{ statusEl.textContent = msg; });
        }catch(err){
          statusEl.textContent = '候補データベースの取得に失敗しました: '+err.message;
          statusEl.className = 'aodpstatus err';
          return;
        }
      }
      statusEl.textContent = '';
      const matches = searchAODPItemIndex(inp.value);
      resultsEl.innerHTML = matches.length
        ? matches.map(m=>`<div class="aodpresultrow" data-pick-id="${m.id}" data-pick-name="${m.name.replace(/"/g,'&quot;')}">
             <span class="aodpresult-id">${m.id}</span><span class="aodpresult-name">${m.name}</span>
           </div>`).join('')
        : `<div class="aodpresult-empty">候補が見つかりません（英語名で検索してください）</div>`;
      resultsEl.querySelectorAll('.aodpresultrow').forEach(row=>{
        row.addEventListener('click', ()=>{
          setAodpCode(itemId, row.dataset.pickId, row.dataset.pickName);
          renderEquipPricePage(); // 選択が確定したのでチップ表示に切り替える
        });
      });
    };

    inp.addEventListener('focus', runSearch);
    inp.addEventListener('input', ()=>{
      if(aodpItemIndex){
        const matches = searchAODPItemIndex(inp.value);
        resultsEl.innerHTML = matches.length
          ? matches.map(m=>`<div class="aodpresultrow" data-pick-id="${m.id}" data-pick-name="${m.name.replace(/"/g,'&quot;')}">
               <span class="aodpresult-id">${m.id}</span><span class="aodpresult-name">${m.name}</span>
             </div>`).join('')
          : `<div class="aodpresult-empty">候補が見つかりません</div>`;
        resultsEl.querySelectorAll('.aodpresultrow').forEach(row=>{
          row.addEventListener('click', ()=>{
            setAodpCode(itemId, row.dataset.pickId, row.dataset.pickName);
            renderEquipPricePage();
          });
        });
      }else{
        runSearch();
      }
    });
  });

  // 変更ボタン：確定済みチップを検索モードに戻す
  grid.querySelectorAll('.aodpchangebtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      setAodpCode(btn.dataset.aodpItem, ''); // 空にする＝未登録扱いに戻す
      renderEquipPricePage();
    });
  });
  // ※ このAODPコードは「販売数分析」タブの出来高（おすすめ製造個数）推定にのみ使う。
  //   価格を自動取得して売値欄に書き込む処理は行わない（価格は必ずユーザーが自分で入力する）。
}

/* =======================================================================
   PAGE 1-D: ボーナスデー — その日ボーナス対象の「武器種・防具種」を登録
   （日替わり生産ボーナスは個別アイテムではなく種類単位で付与される）
======================================================================= */
let bonusCategory = 'weapon';

function renderBonusPage(){
  // ゲーム内のボーナス切り替え時刻（UTC 0:00 / 日本時間9:00）を基準にした「現在のボーナス日」と、
  // 次回切り替わりまでの残り時間を表示する（カレンダー日付とズレることを利用者に明示するため）。
  const infoWrap = document.getElementById('bonusDayInfo');
  if(infoWrap){
    const now = new Date();
    const gameDateKey = todayKey(now);
    const nextResetUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), BONUS_RESET_UTC_HOUR, 0, 0));
    if(nextResetUTC.getTime() <= now.getTime()) nextResetUTC.setUTCDate(nextResetUTC.getUTCDate()+1);
    const msLeft = nextResetUTC.getTime() - now.getTime();
    const hLeft = Math.floor(msLeft/3600000);
    const mLeft = Math.floor((msLeft%3600000)/60000);
    const nextResetJST = new Date(nextResetUTC.getTime() + 9*60*60*1000);
    const jstHour = String((BONUS_RESET_UTC_HOUR+9)%24).padStart(2,'0');
    const jstStr = `${nextResetJST.getUTCFullYear()}-${String(nextResetJST.getUTCMonth()+1).padStart(2,'0')}-${String(nextResetJST.getUTCDate()).padStart(2,'0')} ${jstHour}:00 (JST)`;
    infoWrap.innerHTML = `📅 現在のボーナス日: <b>${gameDateKey}</b>（UTC 0:00 / 日本時間9:00 切り替え基準） ・ 次回切り替わりまで残り <b>${hLeft}時間${mLeft}分</b>（${jstStr}）`;
  }

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
        <div class="field" style="max-width:190px;">
          <label>販売都市</label>
          <select id="stSellingCity">
            ${CITIES.map(c=>`<option value="${c}" ${c===s.sellingCity?'selected':''}>${CITY_LABELS_JA[c]}</option>`).join('')}
            <option value="${BM_LOCATION}" ${s.sellingCity===BM_LOCATION?'selected':''}>${BM_LABEL_JA}（NPC買取・出品手数料なし）</option>
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
        「クラフト都市」を選ぶと、その都市がボーナス都市になっている装備だけ自動的に+15%のボーナス還元率が適用されます。「購入都市」「販売都市」は、原価入力タブで都市ごとに入力した価格のうち、原価計算・利益計算にどの都市の価格を使うかを切り替えます。<br>
        ⚠ ここで選んだ「購入都市」が、原価入力タブの都市タブで実際に価格を入力した都市と<b>一致していないと、原価が0円のまま計算されてしまいます</b>（未入力として扱われるため）。原価入力タブでの選択都市と、この「購入都市」は必ず同じ都市に揃えてください（既定値はどちらもリムハーストです）。<br>
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
  activeCategory: {build:'head', route:'head', trend:'head'},
  searchTerm: {build:'', route:'', trend:''},
  expandedGroups: {build:new Set(), route:new Set(), trend:new Set()},
};

function groupKey(category, sub){
  return category + '::' + (sub===null || sub===undefined ? '_all' : sub);
}

function buildGroups(category, list){
  const order = SUBTYPE_ORDER[category] || [...new Set(list.map(i=>i.subtype))];
  return order.map(sub=>({
    sub,
    label: sub===null ? (CATS.find(c=>c.id===category)||{}).label : (SUBTYPE_LABELS[sub] || sub),
    items: sortByArtifactNeed(list.filter(i=>i.subtype===sub)),
  })).filter(g=>g.items.length>0);
}

function renderItemPicker(pageId, wrap, renderRow, filterFn){
  wrap.innerHTML = '';
  const cat = pickerUIState.activeCategory[pageId];
  const term = pickerUIState.searchTerm[pageId];
  const expanded = pickerUIState.expandedGroups[pageId];

  const base = filterFn ? ITEMS.filter(filterFn) : ITEMS;
  let list = term ? base.filter(i=>i.name.toLowerCase().includes(term)) : base.filter(i=>i.category===cat);

  if(list.length===0){
    wrap.innerHTML = `<div class="empty-hint">${filterFn ? '価格が入力済みの、該当する装備が見つかりません' : '該当する装備が見つかりません'}</div>`;
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

  const buildLinkStatusEl = document.getElementById('buildAodpLinkStatusBanner');
  if(buildLinkStatusEl) buildLinkStatusEl.innerHTML = renderAodpLinkStatusBanner();

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

  const budgetBtn = document.getElementById('buildBudgetAllocateBtn');
  if(budgetBtn && !budgetBtn.dataset.bound){
    budgetBtn.dataset.bound = '1';
    budgetBtn.addEventListener('click', async ()=>{
      const input = document.getElementById('buildBudgetInput');
      const budget = Number(input.value)||0;
      const resultEl = document.getElementById('buildBudgetResult');
      if(budget<=0){ resultEl.innerHTML = `<div class="empty-hint">資金を入力してください</div>`; return; }
      budgetBtn.disabled = true;
      resultEl.innerHTML = `<div class="empty-hint">おすすめ製造個数（販売数分析）を計算中…（AODPの出来高データを取得しています。少し時間がかかります）</div>`;
      try{
        const result = await autoAllocateBudget(budget);
        const {allocated, spent, remaining} = result;
        budgetBtn.disabled = false;
        if(allocated.length===0){
          resultEl.innerHTML = `${renderAodpErrorBanner()}<div class="empty-hint">${budgetAllocateEmptyReason(result)}</div>`;
          return;
        }
        resultEl.innerHTML = `
          ${renderAodpErrorBanner()}
          <div class="matneedgroup">
            <div class="matneedgroup-title">利益率が高い順に追加しました（使用額 ${fmt(spent)} / 残り ${fmt(remaining)}）</div>
            ${allocated.map(a=>`
              <div class="matneedrow">
                <span class="mnlabel">${a.item.name} T${a.tier}.${a.ench}${a.usedRealData?'':'（簡易目安・AODP実データ未取得）'}</span>
                <span class="mnqty">+${a.qtyAdded} 個 追加（合計${a.qtyTotal} / おすすめ${a.recommendedQty}×1.2=マックス${a.maxQty}）</span>
                <span class="mncost">利益率 ${a.margin.toFixed(1)}%</span>
              </div>`).join('')}
          </div>`;
      }catch(err){
        budgetBtn.disabled = false;
        resultEl.innerHTML = `<div class="empty-hint">計算に失敗しました: ${err.message}</div>`;
      }
    });
  }

  const clearListBtn = document.getElementById('clearCraftListBtn');
  if(clearListBtn && !clearListBtn.dataset.bound){
    clearListBtn.dataset.bound = '1';
    clearListBtn.addEventListener('click', ()=>{
      if(Object.keys(STATE.craftList).length===0) return;
      if(confirm('作成リストの中身だけを削除します（価格・ボーナス設定・在庫などはそのまま残ります）。よろしいですか？')){
        STATE.craftList = {};
        saveState();
        renderCraftListPanel();
        updateTopProfit();
        const resultEl = document.getElementById('buildBudgetResult');
        if(resultEl) resultEl.innerHTML = '';
      }
    });
  }

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
    const {net, tax} = computeNetSell(sellPrice, {isBlackMarket: s.sellingCity===BM_LOCATION});
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
   おすすめ製造個数（販売数分析ベース）＋ 資金に応じた自動製造量決定
   ---------------------------------------------------------------------
   ・「販売数分析」タブと同じAODP日次出来高データを使い、装備ごとの
     「1日あたりの目安販売数」を推定して“おすすめ製造個数”とする。
   ・その装備の種類（武器種・防具種）が本日の日替わり生産ボーナス対象の場合は、
     過去にボーナス対象だった日の出来高（記録が3日分以上あるもの）を優先的に使うことで、
     ボーナスデーによる供給過多の影響を考慮する。記録が無ければ通常日の実績、
     それも無ければ全期間平均を使う。
   ・「マックス」＝おすすめ製造個数 × 1.2（切り上げ）。
   ・AODP連携が無い装備は出来高を推定できないため、簡易な既定値を使う
     （販売数分析タブの一覧には出てこないが、資金配分・作成リストには含まれ得るため）。
======================================================================= */
const DEFAULT_RECO_QTY = 5;          // AODP未連携時の簡易目安（個）
const RECO_LOOKBACK_DAYS = 30;       // 出来高推定に使う過去日数
const RECO_CACHE_MS = 20*60*1000;    // 同一装備・同一ティアの再計算をキャッシュする時間
const recoQtyCache = {};             // craftKey -> {recommendedQty, maxQty, ...}

async function getRecommendedCraftQty(item, tier, ench){
  const key = craftKey(item.id, tier, ench);
  const cached = recoQtyCache[key];
  if(cached && (Date.now()-cached.ts) < RECO_CACHE_MS) return cached;

  const isBonusToday = getBonus(item) > 0;
  const aodpCode = getAodpCode(item.id);
  let recommendedQty, avgVolume=null, bonusSamples=0, normalSamples=0;
  const hasAodp = !!aodpCode;

  if(!hasAodp){
    recommendedQty = DEFAULT_RECO_QTY;
  }else{
    let points = [];
    try{ points = await fetchAODPDailyPoints(item, tier, ench, BM_LOCATION, RECO_LOOKBACK_DAYS); }
    catch(e){ points = []; logAodpError(`${item.name} T${tier}.${ench}`, e); }
    if(points.length===0){
      recommendedQty = DEFAULT_RECO_QTY;
    }else{
      const subKey = subtypeKey(item.category, item.subtype);
      const bonusPts=[], normalPts=[];
      points.forEach(p=>{
        const dayLog = STATE.bonusHistory[p.date];
        const wasBonus = !!(dayLog && dayLog[subKey]);
        (wasBonus?bonusPts:normalPts).push(p);
      });
      bonusSamples = bonusPts.length; normalSamples = normalPts.length;
      const avg = arr => arr.length ? arr.reduce((s,p)=>s+p.volume,0)/arr.length : 0;
      if(isBonusToday && bonusSamples>=3){
        avgVolume = avg(bonusPts);   // 本日ボーナス対象：過去のボーナス日実績を優先して反映
      }else if(normalSamples>0){
        avgVolume = avg(normalPts);  // 通常時：通常日の実績
      }else{
        avgVolume = avg(points);     // 内訳が無ければ全期間平均
      }
      recommendedQty = Math.max(1, Math.round(avgVolume));
    }
  }

  const maxQty = Math.max(recommendedQty, Math.ceil(recommendedQty*1.2));
  const usedRealData = avgVolume !== null; // AODPリンク済みでも、データ0件なら結局フォールバック値を使っている
  const result = {recommendedQty, maxQty, avgVolume, hasAodp, usedRealData, isBonusToday, bonusSamples, normalSamples, ts:Date.now()};
  recoQtyCache[key] = result;
  return result;
}

// 利益率が高い順にすべての(装備, ティア, 補正段階)の組み合わせを並べる。
// 資金配分は常にブラックマーケット売値を使い、利益がプラスのものだけを対象にする。
function buildMarginRankedCandidates(){
  const results = [];
  ITEMS.forEach(item=>{
    TIERS4to8.forEach(t=>{
      ENCH.forEach(e=>{
        const sp = getSellPrice(BM_LOCATION, item.id, t, e);
        if(sp<=0) return;
        const c = computeItemCost(item, t, e);
        const {net} = computeNetSell(sp, {isBlackMarket:true});
        const profit = net - c.total;
        if(profit<=0) return;
        const margin = profit/sp*100;
        results.push({item, tier:t, ench:e, sellPrice:sp, cost:c.total, profit, margin});
      });
    });
  });
  results.sort((a,b)=>b.margin-a.margin);
  return results;
}

// buildMarginRankedCandidates() と違い、利益がマイナス/ゼロの装備も含めて
// 「ブラックマーケットの売値が入力済みのすべての(装備,ティア,補正段階)」を対象にする。
// 「価格入力済みの装備を自動分析」機能で使用。
function buildAllPricedCandidates(){
  const results = [];
  ITEMS.forEach(item=>{
    TIERS4to8.forEach(t=>{
      ENCH.forEach(e=>{
        const sp = getSellPrice(BM_LOCATION, item.id, t, e);
        if(sp<=0) return;
        const c = computeItemCost(item, t, e);
        const {net} = computeNetSell(sp, {isBlackMarket:true});
        const profit = net - c.total;
        const margin = sp>0 ? (profit/sp*100) : 0;
        results.push({item, tier:t, ench:e, sellPrice:sp, cost:c.total, profit, margin, hasCost:c.total>0});
      });
    });
  });
  results.sort((a,b)=>b.margin-a.margin);
  return results;
}

// ブラックマーケットの売値が入力済みの装備をすべて対象に、おすすめ製造個数・マックスを一括計算する。
async function analyzeAllPricedItems(){
  clearAodpErrorLog(); // 今回の分析で発生したエラーだけをバナーに表示するため、実行前にログをクリアする
  const candidates = buildAllPricedCandidates();
  const recoList = await Promise.all(candidates.map(c=>getRecommendedCraftQty(c.item, c.tier, c.ench)));
  return candidates.map((c, i)=>({...c, ...recoList[i]}));
}

function renderTrendBulkResult(list, wrap){
  if(list.length===0){
    wrap.innerHTML = `<div class="empty-hint">ブラックマーケットの売値が入力された装備が見つかりません。「原価入力 &gt; 装備売値・アーティファクト」で入力してください。</div>`;
    return;
  }
  const realDataCount = list.filter(r=>r.usedRealData).length;
  const linkedCount = list.filter(r=>r.hasAodp).length;
  const resolvedLoc = resolvedAodpLocationCache[BM_LOCATION];
  const errorBanner = renderAodpErrorBanner(); // 実際に発生した通信エラーがあればここに表示される（F12不要）
  const diagLine = realDataCount===0
    ? `<div class="note" style="margin-bottom:6px;">⚠ ${linkedCount}件がAODPにリンク済みですが、ブラックマーケットの出来高データが1件も取得できていません（全て簡易目安の5個を使用中）。
       ${linkedCount===0
         ? 'まず「原価入力 &gt; 装備売値・アーティファクト」で装備をAODPにリンクしてください。'
         : (errorBanner
             ? '下に具体的なエラー内容を表示しています。'
             : 'リンクは正しいはずですが、AODP側にブラックマーケットの出来高データが無い可能性があります（通信エラーは検出されていません）。')}
       </div>`
    : `<div class="note" style="margin-bottom:6px;">✅ ${realDataCount}/${list.length}件で実際のAODP出来高データを使用しています${resolvedLoc?`（ブラックマーケットのロケーション表記: <code>${resolvedLoc}</code>）`:''}。</div>`;
  wrap.innerHTML = `
    ${errorBanner}
    ${diagLine}
    <div class="matneedgroup-title" style="margin-bottom:4px;">${list.length} 件を分析しました（利益率が高い順）。</div>
    ${list.map(r=>`
      <div class="matneedrow">
        <span class="mnlabel">
          <img class="artthumb" src="${r.item.file}" alt="">
          ${r.item.name} T${r.tier}.${r.ench}
          ${r.usedRealData ? '<span class="citybadge citybadge-hit">実データ</span>' : (r.hasAodp ? '<span class="citybadge citybadge-miss">連携済だがデータ無し</span>' : '<span class="citybadge">未連携・簡易目安</span>')}
          ${r.isBonusToday ? '<span class="citybadge citybadge-hit">本日ボーナス対象</span>' : ''}
        </span>
        <span class="mnqty">おすすめ ${fmt(r.recommendedQty)} 個 ／ マックス ${fmt(r.maxQty)} 個</span>
        <span class="mncost">利益率 ${r.margin.toFixed(1)}%（${r.profit>=0?'+':''}${fmt(r.profit)}/個）</span>
        <button type="button" class="tinybtn trendbulk-addbtn" data-key="${craftKey(r.item.id, r.tier, r.ench)}" data-qty="${r.recommendedQty}">+ 追加</button>
      </div>
    `).join('')}
  `;

  wrap.querySelectorAll('.trendbulk-addbtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const r = list.find(x=>craftKey(x.item.id,x.tier,x.ench)===btn.dataset.key);
      if(!r) return;
      addToCraftList(r.item.id, r.tier, r.ench, Number(btn.dataset.qty));
      btn.textContent = '✓ 追加済み';
      btn.disabled = true;
    });
  });
}

/**
 * 資金を利益率が高い順に装備へ割り当て、装備ごとの「おすすめ製造個数×1.2（マックス）」を
 * 超えないように作成リストへ追加していく。
 * ・すでに手動でマックス以上を追加している装備はスキップ（触らない＝マックス超過を尊重）。
 * ・マックス未満の装備は、資金が続く限りマックスまで積み増す。
 * ・以前は「利益率上位60件だけ」に絞っていたため、その60件が一度マックスまで埋まると
 *   2回目以降のクリックで必ず「見つかりませんでした」になっていた不具合を修正
 *   （利益率が正の候補は全件を対象にする。AODP問い合わせ結果は20分キャッシュされるため、
 *   再クリック時は多くがキャッシュから即座に返る）。
 */
// 「新たに追加できる装備が見つかりませんでした」の原因を具体的に説明するためのメッセージ生成
function budgetAllocateEmptyReason(result){
  const {totalCandidates, cappedCount, cheapestAffordable} = result;
  if(totalCandidates===0){
    return 'ブラックマーケットの売値が入力済みで、かつ利益がプラスになる装備が見つかりません。「原価入力 &gt; 装備売値・アーティファクト」でブラックマーケットの売値を、「原価入力 &gt; 精製素材」で素材価格を入力してください。';
  }
  if(cappedCount>=totalCandidates){
    return `候補 ${totalCandidates} 件はすべて、すでに「おすすめ製造個数×1.2（マックス）」まで作成リストに入っています。これ以上はこの機能では追加されません（数量を減らすか、通常の「追加」でマックスを超えて手動追加してください）。`;
  }
  if(cheapestAffordable!=null){
    return `資金が足りません。追加できる中でもっとも安い装備でも1個あたり ${fmt(cheapestAffordable)} silver かかります。`;
  }
  return 'この資金・条件で追加できる装備が見つかりませんでした。';
}

async function autoAllocateBudget(budget, opts={}){
  clearAodpErrorLog(); // 今回の自動配分で発生したエラーだけをバナーに表示するため、実行前にログをクリアする
  const candidates = buildMarginRankedCandidates();
  const recoList = await Promise.all(candidates.map(c=>getRecommendedCraftQty(c.item, c.tier, c.ench)));

  let remaining = Math.max(0, Number(budget)||0);
  const allocated = [];
  let cappedCount = 0, invalidCostCount = 0, tooExpensiveCount = 0;
  let cheapestAffordable = Infinity;

  candidates.forEach((c, i)=>{
    if(c.cost<=0){ invalidCostCount++; return; } // 原価入力が不足している（デフォルトの購入/クラフト都市に価格未入力）
    const reco = recoList[i];
    const key = craftKey(c.item.id, c.tier, c.ench);
    const existingQty = STATE.craftList[key] ? STATE.craftList[key].qty : 0;
    const room = reco.maxQty - existingQty; // 既にマックス以上なら0以下 → スキップ（手動追加分を尊重）
    if(room<=0){ cappedCount++; return; }
    if(remaining<=0) return;
    const qtyByBudget = Math.floor(remaining / c.cost);
    if(qtyByBudget<=0){ tooExpensiveCount++; cheapestAffordable = Math.min(cheapestAffordable, c.cost); return; }
    const qtyToAdd = Math.min(room, qtyByBudget);
    remaining -= qtyToAdd * c.cost;
    addToCraftList(c.item.id, c.tier, c.ench, qtyToAdd);
    allocated.push({...c, qtyAdded:qtyToAdd, qtyTotal:existingQty+qtyToAdd,
                     maxQty:reco.maxQty, recommendedQty:reco.recommendedQty, hasAodp:reco.hasAodp, usedRealData:reco.usedRealData});
  });

  return {
    allocated, spent:(Number(budget)||0)-remaining, remaining,
    totalCandidates: candidates.length, cappedCount, invalidCostCount, tooExpensiveCount,
    cheapestAffordable: isFinite(cheapestAffordable) ? cheapestAffordable : null,
  };
}

/**
 * 現在の作成リスト（entries: [{item,tier,ench,qty}]）をもとに、装備ごとに
 * 「素材が最安の購入都市→利益が最大になるクラフト都市→最終目的地」を求め、
 * 同じルート（購入都市→クラフト都市→最終目的地）ごとにグループ化してまとめる。
 * calculateOptimalCraftRoutes() と同じロジックだが、全アイテムから最良の1件を探すのではなく、
 * 渡されたリストのアイテム・ティア・補正段階・個数をそのまま使う点が異なる。
 */
function buildRouteSuggestionForEntries(entries, opts={}){
  const destinationCity = opts.destinationCity || STATE.settings.destinationCity || 'Lymhurst';
  const includeCaerleon = !!opts.includeCaerleon;
  const candidateCities = includeCaerleon ? CITIES : CITY_RING;
  const sellCity = BM_LOCATION;

  const itemRoutes = entries.map(({item, tier, ench, qty})=>{
    if(!item || !qty || qty<=0) return null;
    const rawSellPrice = getSellPrice(sellCity, item.id, tier, ench);
    if(rawSellPrice<=0) return null;
    const {net} = computeNetSell(rawSellPrice, {isBlackMarket:true});

    // a. 素材合計購入額が最も安い都市 (MaterialCity)
    let materialCity=null, bestGrossTotal=Infinity;
    candidateCities.forEach(buyCity=>{
      const c = computeItemCost(item, tier, ench, buyCity, buyCity);
      if(c.grossTotal>0 && c.grossTotal<bestGrossTotal){ bestGrossTotal=c.grossTotal; materialCity=buyCity; }
    });
    if(!materialCity) return null;

    // b. 利益が最大となるクラフト都市 (CraftCity)（購入都市はMaterialCityに固定）
    let craftBest=null;
    candidateCities.forEach(craftCity=>{
      const cost = computeItemCost(item, tier, ench, craftCity, materialCity);
      const profit = net-cost.total;
      if(!craftBest || profit>craftBest.profit) craftBest = {craftCity, cost, profit};
    });
    if(!craftBest) return null;

    const margin = rawSellPrice>0 ? (craftBest.profit/rawSellPrice*100) : 0;
    const raw = [materialCity, craftBest.craftCity, destinationCity];
    const waypoints = raw.filter((c,i)=>i===0||c!==raw[i-1]);
    return {
      item, tier, ench, qty, materialCity, craftCity: craftBest.craftCity,
      cost: craftBest.cost, sellPrice: rawSellPrice, net,
      profitPerUnit: craftBest.profit, profitTotal: craftBest.profit*qty, margin,
      waypoints, routeKey: waypoints.join(' -> '),
    };
  }).filter(Boolean);

  const routesMap = {};
  itemRoutes.forEach(r=>{ (routesMap[r.routeKey]=routesMap[r.routeKey]||[]).push(r); });
  Object.values(routesMap).forEach(list=>list.sort((a,b)=>b.profitTotal-a.profitTotal));

  const routeList = Object.keys(routesMap).map(routeKey=>{
    const list = routesMap[routeKey];
    const totalProfit = list.reduce((s,r)=>s+r.profitTotal,0);
    const totalCost = list.reduce((s,r)=>s+r.cost*r.qty,0);
    return {
      routeKey, waypoints:list[0].waypoints, buyCity:list[0].materialCity, craftCity:list[0].craftCity,
      destinationCity, items:list, totalProfit, totalCost,
    };
  });

  routeList.sort((a,b)=>b.totalProfit-a.totalProfit);
  return routeList;
}

// 資金からの自動ルート提案カード。買う物/作る数の内訳はここでは出さず、
// 「🧭 開始」を押した先のカーナビ側に集約して表示する（作成リスト＝作る個数の管理、カーナビ＝買う物/作る物の内訳）。
let lastBudgetRouteList = [];

function budgetRouteCardHtml(route, idx){
  const pathHtml = route.waypoints.map((c,i)=>{
    const isLast = i===route.waypoints.length-1;
    return `<span class="rp-city${isLast?' rp-bonus':''}">${CITY_LABELS_JA[c]||c}</span>`
         + (i<route.waypoints.length-1 ? '<span class="rp-arrow">➔</span>' : '');
  }).join('');

  const itemsHtml = route.items.map(r=>`
    <div class="recorow">
      <span class="rerank">🛒</span>
      <img src="${r.item.file}" alt="${r.item.name}">
      <div class="irname">${r.item.name} <span class="retier">T${r.tier}.${r.ench}</span></div>
      <div class="bstat"><span class="bk">作成リストの個数</span><span class="bv strong">${fmt(r.qty)}</span></div>
      <div class="bstat"><span class="bk">利益（合計）</span><span class="bv strong ${r.profitTotal>=0?'profit-pos':'profit-neg'}">${r.profitTotal>=0?'+':''}${fmt(r.profitTotal)}</span></div>
      <div class="bstat"><span class="bk">利益率</span><span class="bv">${r.margin.toFixed(1)}%</span></div>
    </div>`).join('');

  return `
    <div class="routerow" style="flex-direction:column;align-items:stretch;">
      <div class="routepath" style="font-size:13.5px;">
        ${pathHtml}
        <span class="citybadge citybadge-hit" style="margin-left:8px;">このルートの合計利益 ${fmt(route.totalProfit)}</span>
        <span class="citybadge">仕入れ合計(目安) ${fmt(route.totalCost)}</span>
        <button type="button" class="navstartbtn" data-budgetroute="${idx}">🧭 このルートを開始</button>
      </div>
      ${itemsHtml}
    </div>
  `;
}

function renderBudgetRouteSuggestion(routeList, wrap, {budget, spent, remaining}){
  lastBudgetRouteList = routeList;
  if(routeList.length===0){
    wrap.innerHTML = `<div class="empty-hint">この予算・条件で製造できる装備が見つかりませんでした（ブラックマーケットの売値・素材価格が入力されているか確認してください）。</div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="matneedgroup-title" style="margin-bottom:4px;">資金 ${fmt(budget)} のうち ${fmt(spent)} を使用（残り ${fmt(remaining)}）。作成リスト全体（このボタンで追加した分＋手動追加分）をもとに、同じ移動でまとめて仕入れ・製作できるルート単位でまとめました（合計利益が高い順）。「🧭 開始」を押すと、そのルートの<b>どこで何を何個買うか・どこで何個作るか</b>をカーナビ画面で確認できます。</div>
    ${routeList.map((r,idx)=>budgetRouteCardHtml(r,idx)).join('')}
  `;

  wrap.querySelectorAll('[data-budgetroute]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const route = lastBudgetRouteList[Number(btn.dataset.budgetroute)];
      const items = route.items.map(r=>({item:r.item, tier:r.tier, ench:r.ench, profit:r.profitPerUnit, sellPrice:r.sellPrice, qty:r.qty}));
      startNav(route.buyCity, route.craftCity, route.destinationCity, route.waypoints, items);
    });
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
        const {net} = computeNetSell(sp, {isBlackMarket: s.sellingCity===BM_LOCATION});
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
    document.getElementById('routeMinVolume').addEventListener('change', ()=>{ if(routeSelectedItem) computeAndRenderRoutes(); });
    document.getElementById('routeMaxVolatility').addEventListener('change', ()=>{ if(routeSelectedItem) computeAndRenderRoutes(); });
    document.getElementById('routeBonusDiscount').addEventListener('change', ()=>{ if(routeSelectedItem) computeAndRenderRoutes(); });
    document.getElementById('routeUseMarketData').addEventListener('change', ()=>{ if(routeSelectedItem) computeAndRenderRoutes(); });
  }

  renderNavPanel();
  renderRouteNavPanel();

  renderCategorySidebar('route', document.getElementById('routeCategoryList'), renderRoutePage);

  const search = document.getElementById('routeSearch');
  search.value = pickerUIState.searchTerm.route;
  search.oninput = (e)=>{ pickerUIState.searchTerm.route = e.target.value.trim().toLowerCase(); renderRoutePage(); };

  renderItemPicker('route', document.getElementById('routeItemList'), (item)=>{
    const row = document.createElement('div');
    row.className = 'itemrow';
    const selected = routeSelectedItem && routeSelectedItem.id===item.id;
    const hasAodp = !!getAodpCode(item.id);
    row.innerHTML = `
      <img src="${item.file}" alt="${item.name}">
      <div class="irname">${item.name}${isArtifactItem(item)?'<span class="tag-artifact">Artifact</span>':''}${hasAodp?'<span class="citybadge citybadge-hit">AODP連携済</span>':''}</div>
      <button type="button" class="tinybtn routepickbtn">${selected?'選択中':'この装備で計算'}</button>
    `;
    row.querySelector('.routepickbtn').addEventListener('click', ()=>{
      routeSelectedItem = item;
      computeAndRenderRoutes();
    });
    return row;
  });

  const routeBudgetBtn = document.getElementById('routeBudgetAllocateBtn');
  if(routeBudgetBtn && !routeBudgetBtn.dataset.bound){
    routeBudgetBtn.dataset.bound = '1';
    routeBudgetBtn.addEventListener('click', async ()=>{
      const input = document.getElementById('routeBudgetAllocInput');
      const budget = Number(input.value)||0;
      const resultEl = document.getElementById('routeBudgetResult');
      if(budget<=0){ resultEl.innerHTML = `<div class="empty-hint">資金を入力してください</div>`; return; }
      routeBudgetBtn.disabled = true;
      resultEl.innerHTML = `<div class="empty-hint">おすすめ製造個数（販売数分析）を計算し、ルートを組み立てています…（少し時間がかかります）</div>`;
      try{
        const includeCaerleon = document.getElementById('routeNavIncludeCaerleon').checked;
        const destinationCity = STATE.settings.destinationCity || 'Lymhurst';
        const result = await autoAllocateBudget(budget);
        const {allocated, spent, remaining} = result;

        // ルート提案は「この機能で追加した分」だけでなく、作成リスト全体（手動追加分も含む）を対象にする
        const entries = Object.values(STATE.craftList)
          .map(entry=>({item: ITEMS.find(i=>i.id===entry.itemId), tier:entry.tier, ench:entry.ench, qty:entry.qty}))
          .filter(e=>e.item && e.qty>0);
        const routeList = buildRouteSuggestionForEntries(entries, {includeCaerleon, destinationCity});

        routeBudgetBtn.disabled = false;
        if(entries.length===0){
          resultEl.innerHTML = `${renderAodpErrorBanner()}<div class="empty-hint">${budgetAllocateEmptyReason(result)}</div>`;
          return;
        }
        renderBudgetRouteSuggestion(routeList, resultEl, {budget, spent, remaining});
        resultEl.insertAdjacentHTML('afterbegin', renderAodpErrorBanner());
        if(allocated.length===0){
          resultEl.insertAdjacentHTML('afterbegin', `<div class="note" style="margin-bottom:8px;">ℹ この資金では新規追加はありませんでした（${budgetAllocateEmptyReason(result)}）。既存の作成リストの内容でルートを組みました。</div>`);
        }
      }catch(err){
        routeBudgetBtn.disabled = false;
        resultEl.innerHTML = `<div class="empty-hint">計算に失敗しました: ${err.message}</div>`;
      }
    });
  }

  if(routeSelectedItem) computeAndRenderRoutes();
}

async function computeAndRenderRoutes(){
  const wrap = document.getElementById('routeResultPanel');
  if(!routeSelectedItem){ wrap.innerHTML=''; return; }
  const item = routeSelectedItem;
  const s = STATE.settings;
  const destinationCity = s.destinationCity || 'Lymhurst';

  const tier = Number(document.getElementById('routeTier').value);
  const ench = Number(document.getElementById('routeEnch').value);
  const qty = Math.max(1, Number(document.getElementById('routeQty').value)||1);
  const budget = Number(document.getElementById('routeBudget').value)||0;
  const includeCaerleon = document.getElementById('routeIncludeCaerleon').checked;
  const minVolume = Number(document.getElementById('routeMinVolume').value)||0;
  const maxVolatilityPct = document.getElementById('routeMaxVolatility').value;
  const maxVolatility = maxVolatilityPct!=='' ? Number(maxVolatilityPct)/100 : null;
  const bonusDayDiscount = Number(document.getElementById('routeBonusDiscount').value)||0;
  const useMarketData = document.getElementById('routeUseMarketData').checked;

  // 売却先は常にブラックマーケット（Caerleon）固定なので、市場データもBM分だけ取得すればよい。
  let cityStats = {};
  const aodpCode = getAodpCode(item.id);

  if(useMarketData){
    if(!aodpCode){
      wrap.innerHTML = `<div class="empty-hint">この装備はまだAODPと連携していません。「原価入力 &gt; 装備売値・アーティファクト」で英語名検索から候補を選ぶと、出来高・価格推移を使った分析ができるようになります。<br>（今回は市場データなしで、入力済みの売値のみを使って計算します）</div>`;
    }else{
      wrap.innerHTML = `<div class="empty-hint">直近の出来高・価格推移（ブラックマーケット）を取得中…</div>`;
      try{
        cityStats = await fetchMarketStatsForCities(item, tier, ench, [BM_LOCATION], 7);
      }catch(err){
        wrap.innerHTML = `<div class="empty-hint">市場データの取得に失敗しました: ${err.message}（市場データなしで計算します）</div>`;
      }
    }
  }

  const results = recommendRoutes(item, tier, ench, qty, {
    budget: budget>0 ? budget : Infinity,
    maxRiskTier: includeCaerleon ? RISK.CAERLEON : RISK.ROYAL,
    includeCaerleon,
    destinationCity,
    cityStats,
    minVolume: useMarketData ? minVolume : 0,
    maxVolatility: useMarketData ? maxVolatility : null,
    bonusDayDiscount,
  });

  if(results.length===0){
    wrap.innerHTML = `<div class="empty-hint">条件に合うルートが見つかりません。ブラックマーケットの売値・素材価格が都市ごとに入力されているか、流動性/安定性の条件が厳しすぎないか確認してください。</div>`;
    return;
  }

  const bonusNotice = results[0].isBonusToday
    ? `<div class="note" style="margin-top:10px;">⚠ この装備の種類は本日の日替わり生産ボーナス対象として登録されています。供給過多で値崩れしやすいため、売値を${bonusDayDiscount}%割り引いて保守的に見積もっています。</div>`
    : '';

  wrap.innerHTML = `
    <div class="card">
      <h3>${item.name} T${tier}.${ench} × ${qty} のおすすめルート（最終目的地: ${CITY_LABELS_JA[destinationCity]||destinationCity}）</h3>
      <div class="sub">
        利益/時間が高い順（上位10件）。売却先は${BM_LABEL_JA}固定です。距離はロイヤル都市の環状マップに基づく概算で、
        ${CITY_LABELS_JA[destinationCity]||destinationCity}から${BM_LABEL_JA}（Caerleon）への最終搬入は別途の任意ルートとして計算に含めていません。
        ${useMarketData && aodpCode ? '直近7日の出来高・価格推移（AODP・BM）を考慮しています。' : ''}
      </div>
      <div class="routerows">
        ${results.map((r,idx)=>{
          const st = r.marketStats;
          const pathHtml = r.waypoints.map((c,i)=>{
            const isLast = i===r.waypoints.length-1;
            const isCraftLeg = c===r.craftCity && r.cost.cityBonus;
            return `<span class="rp-city${isLast?' rp-bonus':''}">${CITY_LABELS_JA[c]||c}${isCraftLeg?' 🏙':''}</span>`
                 + (i<r.waypoints.length-1 ? '<span class="rp-arrow">➔</span>' : '');
          }).join('');
          return `
          <div class="routerow">
            <span class="rerank">${idx+1}</span>
            <div class="routepath">
              ${pathHtml}
              <span class="citybadge citybadge-hit" style="margin-left:8px;">売却: ${BM_LABEL_JA}🏴</span>
              ${r.riskTier>0 ? '<span class="citybadge citybadge-miss">⚠ カエルレオン経由（購入/クラフト）</span>' : ''}
              ${st ? `<span class="citybadge ${st.volatility<0.15?'citybadge-hit':'citybadge-miss'}">出来高 ${st.avgVolume.toFixed(1)}/日</span>` : ''}
              ${st ? `<span class="citybadge ${st.volatility<0.15?'citybadge-hit':'citybadge-miss'}">変動係数 ${(st.volatility*100).toFixed(1)}%</span>` : ''}
              ${st && st.trend!==0 ? `<span class="citybadge ${st.trend>=0?'citybadge-hit':'citybadge-miss'}">直近${st.trend>=0?'+':''}${(st.trend*100).toFixed(1)}%</span>` : ''}
            </div>
            <div class="bstat"><span class="bk">原価</span><span class="bv">${fmt(r.materialCost)}</span></div>
            <div class="bstat"><span class="bk">売値(BM)${r.isBonusToday?'(割引後)':''}</span><span class="bv">${fmt(r.sellPrice)}</span></div>
            <div class="bstat"><span class="bk">利益</span><span class="bv ${r.profit>=0?'profit-pos':'profit-neg'}">${r.profit>=0?'+':''}${fmt(r.profit)}</span></div>
            <div class="bstat"><span class="bk">概算所要時間</span><span class="bv">${(0.25*r.legs+0.15).toFixed(2)}h</span></div>
            <div class="bstat"><span class="bk">利益/時間</span><span class="bv strong ${r.profitPerHour>=0?'profit-pos':'profit-neg'}">${fmt(r.profitPerHour)}/h</span></div>
            <button type="button" class="navstartbtn" data-ridx="${idx}">🧭 開始</button>
          </div>`;
        }).join('')}
      </div>
      ${bonusNotice}
    </div>
  `;

  wrap.querySelectorAll('.navstartbtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const idx = Number(btn.dataset.ridx);
      const r = results[idx];
      startNav(r.buyCity, r.craftCity, r.destinationCity, r.waypoints, [
        {item, tier, ench, profit:r.profit/qty, sellPrice:r.sellPrice, qty}
      ]);
    });
  });
}

/* =======================================================================
   まとめ生産ルートナビ（カーナビのついで寄り道機能）の描画
   calculateOptimalCraftRoutes() の結果をルートカード形式で一覧表示する。
======================================================================= */
function routeNavItemRowHtml(entry, isPrimary, addIdx){
  return `
    <div class="recorow" style="${isPrimary?'border-color:var(--gold-soft);':''}">
      <span class="rerank">${isPrimary?'👑':'🛒'}</span>
      <img src="${entry.item.file}" alt="${entry.item.name}">
      <div class="irname">${entry.item.name} <span class="retier">T${entry.tier}.${entry.ench}</span>${isArtifactItem(entry.item)?'<span class="tag-artifact">Artifact</span>':''}</div>
      <div class="bstat"><span class="bk">原価</span><span class="bv">${fmt(entry.cost.total)}</span></div>
      <div class="bstat"><span class="bk">売値(BM)</span><span class="bv">${fmt(entry.sellPrice)}</span></div>
      <div class="bstat"><span class="bk">利益</span><span class="bv strong ${entry.profit>=0?'profit-pos':'profit-neg'}">${entry.profit>=0?'+':''}${fmt(entry.profit)}</span></div>
      <div class="bstat"><span class="bk">利益率</span><span class="bv ${entry.margin>=0?'profit-pos':'profit-neg'}">${entry.margin.toFixed(1)}%</span></div>
      <button type="button" class="tinybtn routenav-addbtn" data-idx="${addIdx}">作成リストに追加</button>
    </div>`;
}

function routeNavCardHtml(route, routeIdx){
  const pathHtml = route.waypoints.map((c,i)=>{
    const isLast = i===route.waypoints.length-1;
    return `<span class="rp-city${isLast?' rp-bonus':''}">${CITY_LABELS_JA[c]||c}</span>`
         + (i<route.waypoints.length-1 ? '<span class="rp-arrow">➔</span>' : '');
  }).join('');

  return `
    <div class="routerow" style="flex-direction:column;align-items:stretch;">
      <div class="routepath" style="font-size:13.5px;">
        ${pathHtml}
        <span class="citybadge citybadge-hit" style="margin-left:8px;">このルートの合計利益 ${fmt(route.routeScore)}</span>
        ${route.otherItemCount>0 ? `<span class="citybadge">他にも${route.otherItemCount}件、同ルートで利益が出る装備あり</span>` : ''}
        <button type="button" class="navstartbtn" data-route="${routeIdx}">🧭 このルートを開始</button>
      </div>
      ${routeNavItemRowHtml(route.primaryItem, true, `${routeIdx}:-1`)}
      ${route.bundleItems.map((b,i)=>routeNavItemRowHtml(b, false, `${routeIdx}:${i}`)).join('')}
    </div>
  `;
}

function renderRouteNavPanel(){
  const wrap = document.getElementById('routeNavPanel');
  if(!wrap) return;
  const s = STATE.settings;

  const destSel = document.getElementById('routeNavDestination');
  if(destSel && !destSel.dataset.filled){
    destSel.innerHTML = CITIES.filter(c=>c!=='Caerleon').map(c=>`<option value="${c}">${CITY_LABELS_JA[c]}</option>`).join('');
    destSel.value = s.destinationCity || 'Lymhurst';
    destSel.dataset.filled = '1';
    destSel.addEventListener('change', e=>{
      s.destinationCity = e.target.value;
      saveState();
      renderRouteNavPanel();
    });
    document.getElementById('routeNavIncludeCaerleon').addEventListener('change', renderRouteNavPanel);
    document.getElementById('routeNavMinProfit').addEventListener('change', renderRouteNavPanel);
  }

  const destinationCity = s.destinationCity || 'Lymhurst';
  const includeCaerleon = document.getElementById('routeNavIncludeCaerleon').checked;
  const minProfit = Number(document.getElementById('routeNavMinProfit').value)||0;

  const routes = calculateOptimalCraftRoutes({destinationCity, includeCaerleon, minProfit});

  if(routes.length===0){
    wrap.innerHTML = `<div class="empty-hint">まとめ生産ルートが見つかりません。「原価入力」タブでブラックマーケットの売値・都市別の素材価格を入力してください。</div>`;
    return;
  }

  const top = routes.slice(0, 12);

  wrap.innerHTML = `
    <div class="card">
      <h3>🧭 まとめ生産ルートナビ（相乗り提案）</h3>
      <div class="sub">
        売却先は${BM_LABEL_JA}固定・ルートの終点（最終目的地）は<b>${CITY_LABELS_JA[destinationCity]||destinationCity}</b>で全装備を計算し、
        同じ経路で一緒に仕入れ・製作できる高利益装備をルート単位でまとめています（ルート合計利益が高い順・上位${top.length}ルート）。
        各ルートの👑がそのルートで最も利益額が高いメインアイテム、🛒が同じ移動で相乗りできるおすすめアイテムです。
      </div>
      ${top.map((route,idx)=>routeNavCardHtml(route, idx)).join('')}
    </div>
  `;

  wrap.querySelectorAll('.routenav-addbtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const [ri, ii] = btn.dataset.idx.split(':').map(Number);
      const route = top[ri];
      const entry = ii===-1 ? route.primaryItem : route.bundleItems[ii];
      addToCraftList(entry.item.id, entry.tier, entry.ench, 1);
    });
  });

  wrap.querySelectorAll('.navstartbtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const idx = Number(btn.dataset.route);
      const route = top[idx];
      const items = [route.primaryItem, ...route.bundleItems]
        .map(e=>({...e, qty: craftListQtyFor(e.item, e.tier, e.ench)}));
      startNav(route.primaryItem.materialCity, route.primaryItem.craftCity, destinationCity, route.waypoints, items);
    });
  });
}

/* =======================================================================
   🧭 カーナビ風ルートガイド（ナビパネル）
   ---------------------------------------------------------------------
   提案されたルートを「開始」すると、地図画像（images/map/albion-royal-map.jpg）の上に
   現在地・次の目的地をハイライト表示し、「次へ進む」ボタンを押した瞬間に画面がリアルタイムに
   （＝押した直後に、リロード不要で）切り替わる、簡易カーナビ風のガイドを表示する。
   ※ GPS等の位置情報は取得できないため、実際の移動をトリガーにした自動進行ではなく、
     ユーザーが到着するたびに手動で「次へ進む」を押して進める形式のガイドです。
======================================================================= */
let activeNav = null; // {materialCity, craftCity, destinationCity, waypoints, items:[{item,tier,ench,profit,sellPrice,qty}], stepIndex}

// 作成リストに登録済みの個数を取得（無ければ1個として扱う）。カーナビの「何個作る/買う」表示に使う。
function craftListQtyFor(item, tier, ench){
  const key = craftKey(item.id, tier, ench);
  const entry = STATE.craftList[key];
  return entry ? entry.qty : 1;
}

// 購入都市で「何を何個買うか」を、ルートに含まれる装備・個数から集計する
function buildNavShoppingList(materialCity, craftCity, items){
  const totals = {};
  items.forEach(e=>{
    const qty = e.qty || 1;
    const c = computeItemCost(e.item, e.tier, e.ench, craftCity, materialCity);
    c.breakdown.forEach(b=>{
      const k = b.id;
      if(!totals[k]) totals[k] = {label:b.label, qty:0, cost:0};
      totals[k].qty += b.rawQty*qty;
      totals[k].cost += b.grossCost*qty;
    });
    if(c.artifactQty>0){
      const ak = `artifact_${e.item.id}_T${e.tier}`;
      if(!totals[ak]) totals[ak] = {label:`${e.item.name} 用アーティファクト`, qty:0, cost:0};
      totals[ak].qty += c.artifactQty*qty;
      totals[ak].cost += c.artifactCost*qty;
    }
  });
  return Object.values(totals);
}

// waypoints上の各都市で「何をすべきか」のアクション一覧＋買う物/作る物の内訳を組み立てる
function buildNavSteps(materialCity, craftCity, destinationCity, waypoints, items){
  const shoppingList = buildNavShoppingList(materialCity, craftCity, items);
  const shoppingCost = shoppingList.reduce((s,m)=>s+m.cost, 0);
  const craftList = items.map(e=>({item:e.item, tier:e.tier, ench:e.ench, qty:e.qty||1}));

  return waypoints.map((city, idx)=>{
    const actions = [];
    const isLast = idx===waypoints.length-1;
    const isBuyStep = city===materialCity;
    const isCraftStep = city===craftCity;
    if(isBuyStep) actions.push('🛒 素材を購入する');
    if(isCraftStep) actions.push('🔨 クラフトを実行する');
    if(isLast) actions.push('📦 スタッシュに保管する（最終目的地）');
    if(actions.length===0) actions.push('➡ 通過するだけでOK（買い物・クラフトなし）');
    return {
      city, actions, isLast,
      shoppingList: isBuyStep ? shoppingList : null,
      shoppingCost: isBuyStep ? shoppingCost : 0,
      craftList: isCraftStep ? craftList : null,
    };
  });
}

function startNav(materialCity, craftCity, destinationCity, waypoints, items){
  activeNav = {
    materialCity, craftCity, destinationCity, waypoints,
    // profitは単価（1個あたり）に統一し、qtyを別途持たせる（買う物/作る物の個数計算に使うため）
    items: items.map(e=>({item:e.item, tier:e.tier, ench:e.ench, profit:e.profit, sellPrice:e.sellPrice, qty:e.qty||1})),
    stepIndex: 0,
  };
  renderNavPanel();
  const panel = document.getElementById('navPanel');
  if(panel) panel.scrollIntoView({behavior:'smooth', block:'start'});
}
function navAdvance(){
  if(!activeNav) return;
  if(activeNav.stepIndex < activeNav.waypoints.length-1){
    activeNav.stepIndex++;
    renderNavPanel();
  }
}
function navBack(){
  if(!activeNav) return;
  if(activeNav.stepIndex>0){
    activeNav.stepIndex--;
    renderNavPanel();
  }
}
function navEnd(){
  activeNav = null;
  renderNavPanel();
}

function renderNavPanel(){
  const wrap = document.getElementById('navPanel');
  if(!wrap) return;
  if(!activeNav){ wrap.innerHTML=''; return; }

  const {materialCity, craftCity, destinationCity, waypoints, items, stepIndex} = activeNav;
  const steps = buildNavSteps(materialCity, craftCity, destinationCity, waypoints, items);
  const cur = steps[stepIndex];
  const isFinished = stepIndex === steps.length-1;

  // 地図マーカー：ルート上の都市は進捗に応じて 済み(緑)／現在地(金・点滅)／これから(グレー) を切り替える。
  // ルートに含まれない都市はデフォルトの薄いグレーのまま表示するだけ。
  const markerHtml = Object.keys(CITY_MAP_COORDS).map(city=>{
    const coord = CITY_MAP_COORDS[city];
    const wpIdx = waypoints.indexOf(city);
    let cls = '';
    if(wpIdx>=0){
      if(wpIdx<stepIndex) cls='done';
      else if(wpIdx===stepIndex) cls='current';
      else cls='upcoming';
    }
    return `<div class="navmarker ${cls}" style="left:${coord.x}%;top:${coord.y}%;">
      <div class="navdot"></div>
      <div class="navlabel">${CITY_LABELS_JA[city]||city}</div>
    </div>`;
  }).join('');

  // ルート経路のライン（SVGオーバーレイ）。通過済み区間は緑の実線、これから進む区間は金色の破線。
  const routePoints = waypoints.map(c=>CITY_MAP_COORDS[c]);
  let lineHtml = '';
  for(let i=0;i<routePoints.length-1;i++){
    const a = routePoints[i], b = routePoints[i+1];
    const passed = i < stepIndex;
    lineHtml += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"
      stroke="${passed?'#4ade80':'#e0ac54'}" stroke-width="0.6"
      stroke-dasharray="${passed?'0':'1.6,1.3'}" vector-effect="non-scaling-stroke" />`;
  }

  const itemListHtml = items.map(e=>`
    <div class="navitemrow">
      <img src="${e.item.file}" alt="${e.item.name}">
      <span class="niname">${e.item.name} T${e.tier}.${e.ench} × ${fmt(e.qty||1)}</span>
      <span class="niprofit">${(e.profit*(e.qty||1))>=0?'+':''}${fmt(e.profit*(e.qty||1))}</span>
    </div>`).join('');

  const shoppingHtml = cur.shoppingList ? `
    <div class="matneedgroup">
      <div class="matneedgroup-title">🛒 ここで何を何個買うか（合計 ${fmt(cur.shoppingCost)}）</div>
      ${cur.shoppingList.map(m=>`
        <div class="matneedrow"><span class="mnlabel">${m.label}</span><span class="mnqty">${fmt(m.qty)} 個</span><span class="mncost">${fmt(m.cost)}</span></div>
      `).join('') || '<div class="empty-hint">購入する素材はありません</div>'}
    </div>` : '';

  const craftListHtml = cur.craftList ? `
    <div class="matneedgroup">
      <div class="matneedgroup-title">🔨 ここで何個作るか</div>
      ${cur.craftList.map(c=>`
        <div class="matneedrow"><span class="mnlabel"><img class="artthumb" src="${c.item.file}" alt=""> ${c.item.name} T${c.tier}.${c.ench}</span><span class="mnqty">${fmt(c.qty)} 個</span></div>
      `).join('')}
    </div>` : '';

  wrap.innerHTML = `
    <div class="navpanel">
      <div class="navpanel-head">
        <h3>🧭 カーナビ：${CITY_LABELS_JA[materialCity]||materialCity} ➔ … ➔ ${CITY_LABELS_JA[destinationCity]||destinationCity}</h3>
        <button type="button" class="navpanel-close" id="navCloseBtn">✕ ルートを終了</button>
      </div>
      <div class="navpanel-body">
        <div class="navmap">
          <img src="images/map/albion-royal-map.jpg" alt="Albion Online ロイヤル大陸マップ">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">${lineHtml}</svg>
          ${markerHtml}
        </div>
        <div class="navinfo">
          <div class="navstepbadge">STEP ${stepIndex+1} / ${steps.length}</div>
          <div class="navcurrentcity">📍 現在地: ${CITY_LABELS_JA[cur.city]||cur.city}</div>
          <div class="navactions">
            ${cur.actions.map(a=>`<div class="navaction">${a}</div>`).join('')}
          </div>
          ${shoppingHtml}
          ${craftListHtml}
          ${isFinished ? `<div class="note">✅ このルートは完了です。あとはご都合の良いタイミングで${CITY_LABELS_JA[destinationCity]||destinationCity}から🏴${BM_LABEL_JA}（${CITY_LABELS_JA['Caerleon']}）へ持ち込んで売却してください（この最終搬入はルート計算には含まれていません）。</div>` : ''}
          <div class="navbtnrow">
            ${stepIndex>0 ? `<button type="button" class="navbtn secondary" id="navBackBtn">← 前の地点</button>` : ''}
            ${!isFinished
              ? `<button type="button" class="navbtn" id="navNextBtn">${CITY_LABELS_JA[waypoints[stepIndex+1]]||waypoints[stepIndex+1]}へ向かう →</button>`
              : `<button type="button" class="navbtn" id="navFinishBtn">🏁 ルートを完了する</button>`}
          </div>
          <div>
            <div class="sub" style="margin:6px 0 2px;">このルートで作る装備（作成リストの個数）</div>
            <div class="navitemlist">${itemListHtml}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('navCloseBtn').addEventListener('click', navEnd);
  const nextBtn = document.getElementById('navNextBtn');
  if(nextBtn) nextBtn.addEventListener('click', navAdvance);
  const backBtn = document.getElementById('navBackBtn');
  if(backBtn) backBtn.addEventListener('click', navBack);
  const finishBtn = document.getElementById('navFinishBtn');
  if(finishBtn) finishBtn.addEventListener('click', navEnd);
}

/* =======================================================================
   PAGE 5: 傾向分析 — 日替わりボーナスの実績ログ × AODP価格推移
   ---------------------------------------------------------------------
   注意：Albion公式・AODPともに「今日どの武器種/防具種がボーナス対象か」を
   直接返すAPIは存在しない（本ツールの調査時点）。また日替わりボーナスは
   サーバー単位で毎日ランダムに選ばれる仕組みで、公開されている固定スケジュール
   （曜日ごとの割り当て表など）も見つからなかった。
   そのため、このページは「固定テーブル」ではなく、ユーザーが「原価入力 > ボーナスデー」
   でボーナス対象を登録するたびに自動で蓄積される実績ログ（STATE.bonusHistory）を
   使い、AODPの価格推移データと突き合わせて「ボーナス日は実際に値崩れしていたか」を
   後から振り返るための機能にしている。記録が少ないうちは参考程度にしかならない点に注意。
======================================================================= */
let trendSelectedItem = null;

function renderTrendPage(){
  const tierSel = document.getElementById('trendTier');
  const enchSel = document.getElementById('trendEnch');
  if(!tierSel.dataset.filled){
    tierSel.innerHTML = TIERS4to8.map(t=>`<option value="${t}">T${t}</option>`).join('');
    enchSel.innerHTML = ENCH.map(e=>`<option value="${e}">.${e}</option>`).join('');
    tierSel.value = STATE.settings.tier;
    enchSel.value = STATE.settings.ench;
    tierSel.dataset.filled = '1';
    // 分析する売却先はメインの利益源であるブラックマーケットに固定（都市は選べない）
    document.getElementById('trendLocation').innerHTML = `<option value="${BM_LOCATION}">${BM_LABEL_JA}</option>`;
    document.getElementById('trendLocation').value = BM_LOCATION;
    // ティア・補正段階を変えると「価格入力済みの装備」の判定対象が変わるため、一覧も含めて再描画する
    tierSel.addEventListener('change', renderTrendPage);
    enchSel.addEventListener('change', renderTrendPage);
    document.getElementById('trendDays').addEventListener('change', ()=>{ if(trendSelectedItem) computeAndRenderTrend(); });

    const connTestBtn = document.getElementById('aodpConnTestBtn');
    connTestBtn.addEventListener('click', ()=>{ runAodpConnectivityTest(document.getElementById('aodpConnTestResult')); });

    const bulkBtn = document.getElementById('trendBulkAnalyzeBtn');
    bulkBtn.addEventListener('click', async ()=>{
      const resultEl = document.getElementById('trendBulkResult');
      bulkBtn.disabled = true;
      resultEl.innerHTML = `<div class="empty-hint">価格入力済みの装備を分析中…（AODPの出来高データを取得しています。件数が多いと少し時間がかかります）</div>`;
      try{
        const list = await analyzeAllPricedItems();
        renderTrendBulkResult(list, resultEl);
      }catch(err){
        resultEl.innerHTML = `<div class="empty-hint">分析に失敗しました: ${err.message}</div>`;
      }finally{
        bulkBtn.disabled = false;
      }
    });
  }

  renderCategorySidebar('trend', document.getElementById('trendCategoryList'), renderTrendPage);
  const linkStatusEl = document.getElementById('aodpLinkStatusBanner');
  if(linkStatusEl) linkStatusEl.innerHTML = renderAodpLinkStatusBanner();

  const search = document.getElementById('trendSearch');
  search.value = pickerUIState.searchTerm.trend;
  search.oninput = (e)=>{ pickerUIState.searchTerm.trend = e.target.value.trim().toLowerCase(); renderTrendPage(); };

  renderTrendItemList();

  renderBonusHistorySummary();
  if(trendSelectedItem) computeAndRenderTrend();
}

// ブラックマーケットの売値が入力済みの装備だけを一覧に出す（現在選択中のティア・補正段階が対象）
function renderTrendItemList(){
  const tier = Number(document.getElementById('trendTier').value);
  const ench = Number(document.getElementById('trendEnch').value);
  renderItemPicker('trend', document.getElementById('trendItemList'), (item)=>{
    const row = document.createElement('div');
    row.className = 'itemrow';
    const selected = trendSelectedItem && trendSelectedItem.id===item.id;
    const hasAodp = !!getAodpCode(item.id);
    row.innerHTML = `
      <img src="${item.file}" alt="${item.name}">
      <div class="irname">${item.name}${isArtifactItem(item)?'<span class="tag-artifact">Artifact</span>':''}${hasAodp?'<span class="citybadge citybadge-hit">AODP連携済</span>':''}</div>
      <button type="button" class="tinybtn trendpickbtn">${selected?'選択中':'この装備で分析'}</button>
    `;
    row.querySelector('.trendpickbtn').addEventListener('click', ()=>{
      trendSelectedItem = item;
      computeAndRenderTrend();
    });
    return row;
  }, item => getSellPrice(BM_LOCATION, item.id, tier, ench) > 0);
}

// ボーナス登録の実績ログ（曜日別の記録回数）。あくまで「これまでこのツールで記録した回数」であり、
// ゲーム内の実際の抽選に曜日の偏りがあることを示すものではない点に注意。
function renderBonusHistorySummary(){
  const wrap = document.getElementById('trendHistorySummary');
  const dates = Object.keys(STATE.bonusHistory).sort();
  if(dates.length===0){
    wrap.innerHTML = `<div class="empty-hint">まだボーナス登録の記録がありません。「原価入力 &gt; ボーナスデー」で登録するたびに、この端末に日付付きで記録が蓄積されていきます。</div>`;
    return;
  }
  const WD_JA = ['日','月','火','水','木','金','土'];
  const wdCount = [0,0,0,0,0,0,0];
  dates.forEach(dStr=>{
    const d = new Date(dStr+'T00:00:00');
    if(!isNaN(d.getTime())) wdCount[d.getDay()]++;
  });
  wrap.innerHTML = `
    <div class="card">
      <h3>ボーナス登録の実績ログ（${dates.length}日分・この端末のみ）</h3>
      <div class="sub">記録期間: ${dates[0]} 〜 ${dates[dates.length-1]}。公式に固定スケジュールは無いため、これは「これまで登録した実績」の集計です。曜日の偏りに見えても、記録数が少ないうちは偶然の可能性が高い点に注意してください。</div>
      <div class="routerows" style="margin-top:10px;">
        ${WD_JA.map((label,i)=>`
          <div class="routerow" style="grid-template-columns:60px 1fr;">
            <span class="rerank">${label}曜</span>
            <div class="bstat"><span class="bk">記録回数</span><span class="bv strong">${wdCount[i]}</span></div>
          </div>`).join('')}
      </div>
    </div>
  `;
}

async function computeAndRenderTrend(){
  const wrap = document.getElementById('trendResultPanel');
  if(!trendSelectedItem){ wrap.innerHTML=''; return; }
  const item = trendSelectedItem;
  const tier = Number(document.getElementById('trendTier').value);
  const ench = Number(document.getElementById('trendEnch').value);
  const location = document.getElementById('trendLocation').value;
  const days = Math.min(90, Math.max(7, Number(document.getElementById('trendDays').value)||30));

  const aodpCode = getAodpCode(item.id);
  if(!aodpCode){
    wrap.innerHTML = `<div class="empty-hint">この装備はまだAODPと連携していません。「原価入力 &gt; 装備売値・アーティファクト」で英語名検索から候補を選んでください。</div>`;
    return;
  }

  wrap.innerHTML = `<div class="empty-hint">直近${days}日分の価格推移を取得中…</div>`;
  let points;
  try{
    points = await fetchAODPDailyPoints(item, tier, ench, location, days);
  }catch(err){
    wrap.innerHTML = `<div class="empty-hint">価格推移の取得に失敗しました: ${err.message}</div>`;
    return;
  }
  if(points.length===0){
    wrap.innerHTML = `<div class="empty-hint">この期間・売却先の価格データが見つかりませんでした（出来高が少ないアイテムの可能性があります）。</div>`;
    return;
  }

  const subKey = subtypeKey(item.category, item.subtype);
  const bonusPoints = [], normalPoints = [];
  points.forEach(p=>{
    const dayLog = STATE.bonusHistory[p.date];
    const wasBonus = !!(dayLog && dayLog[subKey]);
    (wasBonus ? bonusPoints : normalPoints).push(p);
  });

  function avg(arr, field){ return arr.length ? arr.reduce((s,p)=>s+p[field],0)/arr.length : 0; }
  const bonusAvgPrice = avg(bonusPoints, 'avgPrice');
  const normalAvgPrice = avg(normalPoints, 'avgPrice');
  const bonusAvgVol = avg(bonusPoints, 'volume');
  const normalAvgVol = avg(normalPoints, 'volume');
  const priceDiffPct = normalAvgPrice>0 ? ((bonusAvgPrice-normalAvgPrice)/normalAvgPrice*100) : 0;

  const reliabilityNote = bonusPoints.length < 3
    ? `<div class="note" style="margin-top:10px;">⚠ この装備の種類（${SUBTYPE_LABELS[item.subtype]||item.subtype}）がボーナス対象として記録されている日が${bonusPoints.length}日分しかないため、参考程度の数値です。使い続けるほど記録が増え、精度が上がります。</div>`
    : '';

  // 「作成リスト」「ルート提案」の資金自動配分ボタンが使うのと同じロジックで、
  // このタブ上でも「おすすめ製造個数」「マックス（×1.2）」を確認できるようにする。
  const reco = await getRecommendedCraftQty(item, tier, ench);
  const recoBasisLabel = reco.isBonusToday && reco.bonusSamples>=3
    ? `本日ボーナス対象・過去のボーナス日実績（${reco.bonusSamples}日分）を基準`
    : (reco.normalSamples>0 ? `通常日実績（${reco.normalSamples}日分）を基準` : '全期間平均を基準');
  const recoBlock = `
    <div class="card" style="margin-top:14px;">
      <h3>🎯 おすすめ製造個数（本日時点）</h3>
      <div class="sub">直近${RECO_LOOKBACK_DAYS}日間のブラックマーケット出来高から、ボーナスデーの影響（本日ボーナス対象かどうか）を考慮して推定しています。${recoBasisLabel}。</div>
      <div class="routerows" style="margin-top:10px;">
        <div class="routerow">
          <span class="rerank">💡</span>
          <div class="bstat"><span class="bk">おすすめ製造個数</span><span class="bv strong">${reco.recommendedQty} 個/日</span></div>
          <div class="bstat"><span class="bk">マックス（おすすめ×1.2）</span><span class="bv strong" style="color:var(--gold);">${reco.maxQty} 個</span></div>
          ${reco.isBonusToday ? '<span class="citybadge citybadge-miss">本日ボーナス対象</span>' : ''}
        </div>
      </div>
      <div class="note">「作成リスト」「ルート提案」タブの「資金内で製造量を自動決定」ボタンは、このマックスを超えないように製造量を決定します（手動での追加はこれまで通りマックスを超えられます）。</div>
    </div>
  `;

  wrap.innerHTML = `
    <div class="card">
      <h3>${item.name} T${tier}.${ench}（売却先: ${location===BM_LOCATION?BM_LABEL_JA:CITY_LABELS_JA[location]}）の価格推移分析</h3>
      <div class="sub">直近${days}日間のAODP日次データ（合計${points.length}日分）を、「原価入力 &gt; ボーナスデー」の登録履歴と突き合わせています。</div>
      <div class="routerows" style="margin-top:10px;">
        <div class="routerow">
          <span class="rerank">📈</span>
          <div class="bstat"><span class="bk">ボーナス日の平均売値（${bonusPoints.length}日分）</span><span class="bv strong">${bonusPoints.length? fmt(bonusAvgPrice) : '—'}</span></div>
          <div class="bstat"><span class="bk">平均出来高</span><span class="bv">${bonusPoints.length? bonusAvgVol.toFixed(1)+'/日' : '—'}</span></div>
        </div>
        <div class="routerow">
          <span class="rerank">📊</span>
          <div class="bstat"><span class="bk">通常日の平均売値（${normalPoints.length}日分）</span><span class="bv strong">${normalPoints.length? fmt(normalAvgPrice) : '—'}</span></div>
          <div class="bstat"><span class="bk">平均出来高</span><span class="bv">${normalPoints.length? normalAvgVol.toFixed(1)+'/日' : '—'}</span></div>
        </div>
        ${bonusPoints.length && normalPoints.length ? `
        <div class="routerow">
          <span class="rerank">差</span>
          <div class="bstat"><span class="bk">ボーナス日 vs 通常日</span><span class="bv strong ${priceDiffPct<0?'profit-neg':'profit-pos'}">${priceDiffPct>=0?'+':''}${priceDiffPct.toFixed(1)}%</span></div>
        </div>` : ''}
      </div>
      ${reliabilityNote}
    </div>
  `;
}

/* AODPの日次チャートから生データ（日付・平均価格・出来高）を取り出す。
   ※ AODPのchartsレスポンスの日時フィールド名は timestamp を想定しているが、
   仕様変更があった場合は下のフォールバック（date）も試す。 */
async function fetchAODPDailyPoints(item, tier, ench, location, days=30){
  const code = getAodpCode(item.id);
  if(!code) return [];
  const m = code.match(/^T\d+_(.+)$/);
  if(!m) return [];
  const id = `T${tier}_${m[1]}` + (ench>0 ? `@${ench}` : '');
  const {raw} = await fetchAODPChartWithLocationFallback(id, location, days);
  return raw.slice(-days).map(p=>{
    const rawDate = p.timestamp || p.date || '';
    return {date: String(rawDate).slice(0,10), avgPrice: Number(p.avg_price)||0, volume: Number(p.item_count)||0};
  }).filter(p=>p.date && p.avgPrice>0);
}
function daysAgoDateStr(days){
  const d = new Date(Date.now() - days*86400000);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
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
