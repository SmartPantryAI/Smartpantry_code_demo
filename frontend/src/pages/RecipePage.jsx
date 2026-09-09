import React, { useEffect, useState } from 'react';
import { Clock, CheckCircle2, RefreshCw, ChevronDown, ChevronUp, AlertCircle, Heart, X } from 'lucide-react';
import FoodIcon from '../components/FoodIcon';
import { formatPantryQuantity } from '../utils/quantityFormat';
import { convertQuantity } from '../utils/unitConvert';

const FOOD_EMOJIS = [
  '🍳', '🥘', '🍲', '🥗', '🍜', '🍱', '🥙', '🫕',
  '🍛', '🍝', '🍕', '🍚', '🥪', '🥟', '🍤', '🥩',
  '🐟', '🍞', '🥞', '🍙', '🍣', '🍢', '🍡', '🧆',
];

// 레시피 이름/재료에 포함된 키워드로 음식 종류를 추정해 알맞은 이모지를 고른다
const FOOD_KEYWORD_EMOJIS = [
  { keywords: ['파스타', '스파게티', '까르보나라', '알리오'], emoji: '🍝' },
  { keywords: ['피자'], emoji: '🍕' },
  { keywords: ['카레', '커리'], emoji: '🍛' },
  { keywords: ['초밥', '스시'], emoji: '🍣' },
  { keywords: ['김밥'], emoji: '🍙' },
  { keywords: ['만두', '교자'], emoji: '🥟' },
  { keywords: ['떡볶이', '꼬치', '어묵'], emoji: '🍢' },
  { keywords: ['튀김', '까스', '탕수육', '치킨', '프라이'], emoji: '🍤' },
  { keywords: ['스테이크', '구이', '불고기', '갈비', '삼겹살', '고기'], emoji: '🥩' },
  { keywords: ['생선', '조림', '고등어', '연어', '해물', '오징어', '새우'], emoji: '🐟' },
  { keywords: ['덮밥', '비빔밥', '볶음밥', '밥'], emoji: '🍚' },
  { keywords: ['국수', '우동', '라면', '냉면', '잔치국수', '쌀국수'], emoji: '🍜' },
  { keywords: ['국', '탕', '찌개', '전골', '스튜', '수프'], emoji: '🍲' },
  { keywords: ['볶음', '잡채'], emoji: '🥘' },
  { keywords: ['샐러드'], emoji: '🥗' },
  { keywords: ['샌드위치', '토스트', '버거'], emoji: '🥪' },
  { keywords: ['빵', '베이킹'], emoji: '🍞' },
  { keywords: ['팬케이크', '부침개', '전'], emoji: '🥞' },
  { keywords: ['계란', '오믈렛', '에그'], emoji: '🍳' },
];

const getRecipeEmoji = (recipe, idx) => {
  const text = [recipe?.name, ...(recipe?.used_ingredients || []).map(i => i.name)].join(' ');
  const matched = FOOD_KEYWORD_EMOJIS.find(({ keywords }) =>
    keywords.some(k => text.includes(k))
  );
  return matched ? matched.emoji : FOOD_EMOJIS[idx % FOOD_EMOJIS.length];
};

const CookModal = ({ recipe, pantryItems, onClose, onConfirm }) => {
  const [usages, setUsages] = useState(() => {
    const found = [];
    for (const ing of (recipe.used_ingredients || [])) {
      // 서버가 recipe_ingredients 원본을 구조화 객체로 내려주므로 문자열 재파싱은 하지 않는다.
      const parsedName = ing.name;
      const parsedQty  = ing.amount;
      const parsedUnit = ing.unit;
      const pantryItem = pantryItems.find(p =>
        p.item_name.includes(parsedName) || parsedName.includes(p.item_name)
      );
      if (!pantryItem) continue; // 저장고에 없는 재료는 제외

      const maxQty = Number(pantryItem.quantity);
      // 펜트리에 단위가 비어있는(레거시 데이터 등) 경우 '개'로 취급한다 - 화면 표시뿐 아니라
      // 환산 기준 단위(targetUnit)도 이 값과 일치시켜야 convertQuantity가 null을 반환하지 않는다.
      const pantryUnit = pantryItem.unit || '개';
      // 단위 토큰이 없으면 펜트리 단위와 동일하다고 가정한다(기존 동작과 호환).
      const convertedQty = (parsedQty !== null && Number.isFinite(parsedQty) && parsedQty > 0)
        ? convertQuantity({
            qty: parsedQty,
            unit: parsedUnit || pantryUnit,
            targetUnit: pantryUnit,
            ingredientName: parsedName,
          })
        : null;
      // 단위 환산이 불가능하면(예: 개수 ↔ 무게) 자동으로 전량을 차감하지 않는다 -
      // 재고 오차를 막기 위해 0으로 시작하고 사용자가 직접 입력하도록 경고를 띄운다.
      const convertFailed = !(convertedQty !== null && Number.isFinite(convertedQty) && convertedQty > 0);
      const initialQty = convertFailed ? 0 : Math.min(convertedQty, maxQty);

      found.push({
        label:          `${parsedQty ?? ''}${parsedUnit ?? ''} ${parsedName}`.trim(),
        name:           parsedName,
        pantry_item_id: pantryItem.id,
        used_qty:       initialQty,
        max_qty:        maxQty,
        unit:           pantryUnit,
        convertFailed,
      });
    }
    return found;
  });

  const setUsage = (idx, field, val) =>
    setUsages(prev => prev.map((u, i) => i === idx ? { ...u, [field]: val } : u));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-[430px] bg-white rounded-t-[32px] p-6 space-y-5 shadow-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-black text-gray-950">사용한 재료 입력</h3>
            <p className="text-xs text-gray-400 mt-0.5">{recipe.name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 transition-colors">
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        <div className="space-y-3">
          {usages.map((u, idx) => (
            <div key={idx} className="p-4 rounded-2xl bg-gray-50 border border-gray-100 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-gray-800">{u.label}</p>
                <span className="text-[10px] text-gray-400 font-bold">보유 {formatPantryQuantity(u.max_qty, u.unit)}</span>
              </div>
              {u.convertFailed && (
                <p className="text-[11px] font-bold text-amber-600">⚠️ 자동 환산 불가 — 직접 입력해주세요</p>
              )}
              <div className="flex items-center gap-2">
                {/* 수량 입력 - 펜트리에 저장된 고유 단위(u.unit) 기준으로만 입력. 단위 환산은 하지 않음 */}
                {u.unit === '개' ? (
                  <div className="flex items-center gap-2 flex-1">
                    <button
                      onClick={() => setUsage(idx, 'used_qty', Math.max(0.25, u.used_qty - 0.25))}
                      disabled={u.used_qty <= 0.25}
                      className="w-9 h-9 rounded-xl border border-gray-200 text-lg font-bold text-gray-600 bg-white hover:bg-gray-100 active:scale-95 transition-all disabled:opacity-30"
                    >−</button>
                    <span className="flex-1 text-center text-base font-black text-gray-900">{formatPantryQuantity(u.used_qty, u.unit)}</span>
                    <button
                      onClick={() => setUsage(idx, 'used_qty', Math.min(u.max_qty, u.used_qty + 0.25))}
                      disabled={u.used_qty >= u.max_qty}
                      className="w-9 h-9 rounded-xl border border-gray-200 text-lg font-bold text-gray-600 bg-white hover:bg-gray-100 active:scale-95 transition-all disabled:opacity-30"
                    >+</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 flex-1">
                    <input
                      type="number"
                      min="1"
                      max={u.max_qty}
                      value={u.used_qty}
                      onChange={e => setUsage(idx, 'used_qty', Math.min(u.max_qty, Math.max(1, Number(e.target.value) || 1)))}
                      className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm font-bold text-gray-900 focus:outline-none focus:border-gray-400 text-center bg-white"
                    />
                    <span className="text-sm font-black text-gray-500">{u.unit}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {usages.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-4">내 저장고에 있는 재료가 없어요</p>
        )}

        <button
          onClick={() => onConfirm(usages)}
          className="w-full py-4 bg-gray-950 text-white rounded-[20px] font-black text-sm active:scale-[0.98] transition-all"
        >
          🍳 요리 시작 · 재료 사용 처리
        </button>
      </div>
    </div>
  );
};

const RecipeCard = ({ recipe, idx, isBookmarked, onToggleSave, onCook, expandedIdx, setExpandedIdx }) => (
  <div className="rounded-[32px] bg-gray-50 border border-gray-100 overflow-hidden">
    <div className="h-36 bg-gradient-to-br from-gray-800 to-gray-600 flex items-center justify-center relative">
      <span className="text-6xl">{getRecipeEmoji(recipe, idx)}</span>
      <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-md px-3 py-1 rounded-2xl flex items-center gap-1.5 shadow-sm">
        <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${recipe.source === 'llm' ? 'bg-purple-500' : 'bg-blue-500'}`} />
        <span className={`text-[11px] font-black ${recipe.source === 'llm' ? 'text-purple-600' : 'text-blue-600'}`}>
          {recipe.source === 'llm' ? 'AI 창작 레시피' : 'AI 추천'}
        </span>
      </div>
      <button
        onClick={onToggleSave}
        className="absolute top-4 right-4 w-9 h-9 bg-white/90 backdrop-blur-md rounded-2xl flex items-center justify-center shadow-sm active:scale-90 transition-all"
      >
        <Heart size={16} className={isBookmarked ? 'text-red-500 fill-red-500' : 'text-gray-400'} />
      </button>
    </div>

    <div className="p-5">
      <div className="flex justify-between items-start mb-3">
        <h3 className="text-xl font-black text-gray-900 flex-1 pr-3">{recipe.name}</h3>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`px-3 py-1 rounded-2xl text-[11px] font-black ${
            recipe.difficulty === '쉬움' ? 'bg-green-50 text-green-600' :
            recipe.difficulty === '보통' ? 'bg-yellow-50 text-yellow-600' : 'bg-red-50 text-red-600'
          }`}>{recipe.difficulty || '보통'}</span>
          <div className="flex items-center gap-1 text-gray-400 bg-white px-2.5 py-1.5 rounded-xl border border-gray-100">
            <Clock size={13} />
            <span className="text-[11px] font-bold">{recipe.time || '?'}</span>
          </div>
        </div>
      </div>

      {recipe.used_ingredients?.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">재료</p>
          <div className="flex flex-wrap gap-1.5">
            {recipe.used_ingredients.map((ing, i) => (
              <div key={i} className="flex items-center gap-1 bg-white px-2.5 py-1 rounded-full border border-gray-100 text-[10px] font-bold text-gray-500">
                <CheckCircle2 size={10} className="text-green-500" />
                {ing.amount ?? ''}{ing.unit ?? ''} {ing.name}
              </div>
            ))}
            {recipe.missing_ingredients?.map((ing, i) => (
              <div key={i} className="flex items-center gap-1 bg-white px-2.5 py-1 rounded-full border border-gray-100 text-[10px] font-bold text-gray-400 opacity-60">
                <span className="w-2 h-2 rounded-full border border-gray-300 inline-block" />
                {ing}
              </div>
            ))}
          </div>
        </div>
      )}

      {recipe.steps?.length > 0 && (
        <button
          onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
          className="w-full py-3 bg-white border border-gray-100 rounded-2xl text-sm font-bold text-gray-600 flex items-center justify-center gap-1.5 active:bg-gray-50 transition-colors"
        >
          {expandedIdx === idx ? <><ChevronUp size={15} /> 접기</> : <><ChevronDown size={15} /> 조리 방법 보기</>}
        </button>
      )}
    </div>

    {expandedIdx === idx && recipe.steps?.length > 0 && (
      <div className="border-t border-gray-100 bg-white px-5 py-5 space-y-5">
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">조리 순서</p>
        {recipe.steps.map((step, si) => {
          const colonIdx = step.indexOf(':');
          const hasTitle = colonIdx > 0 && colonIdx < 15;
          const title = hasTitle ? step.slice(0, colonIdx).trim() : null;
          const body = hasTitle ? step.slice(colonIdx + 1).trim() : step;
          return (
            <div key={si} className="flex gap-3 items-start">
              <span className="w-7 h-7 bg-gray-900 text-white text-xs font-black rounded-full flex items-center justify-center shrink-0 mt-0.5">
                {si + 1}
              </span>
              <div className="flex-1">
                {title && <p className="text-xs font-black text-gray-800 mb-0.5">{title}</p>}
                <p className="text-sm text-gray-600 font-medium leading-relaxed">{body}</p>
              </div>
            </div>
          );
        })}

        {recipe.tips?.length > 0 && (
          <div className="bg-amber-50 rounded-2xl px-4 py-3 space-y-1.5 border border-amber-100">
            <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1">💡 요리 팁</p>
            {recipe.tips.map((tip, ti) => (
              <p key={ti} className="text-xs text-amber-700 font-medium leading-relaxed">{tip}</p>
            ))}
          </div>
        )}

        <button
          onClick={onCook}
          className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black text-sm active:scale-[0.98] transition-all"
        >
          🍳 이 레시피로 요리할게요
        </button>
      </div>
    )}
  </div>
);

const RecipePage = () => {
  const [tab, setTab] = useState('recommend');
  const [recipes, setRecipes] = useState([]);
  const [savedRecipes, setSavedRecipes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savedLoading, setSavedLoading] = useState(false);
  const [pantryItems, setPantryItems] = useState([]);
  const [pantryLoading, setPantryLoading] = useState(true);
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [fetched, setFetched] = useState(false);
  const [savedMap, setSavedMap] = useState({});
  const [toast, setToast] = useState(null);
  const [priorityItems, setPriorityItems] = useState(null);
  const [showAllIngredients, setShowAllIngredients] = useState(false);
  const [cookTarget, setCookTarget] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // expiry_date는 UTC 자정(...T00:00:00.000Z)으로 내려오는데, 로컬 자정으로만 맞춘 today와
  // 그대로 빼면 시간대 오프셋만큼 날짜가 밀린다(KST +9시간 → Math.ceil이 하루를 더 얹어서
  // 실제 D-3인 재료가 D-4로 계산됨 - 그 결과 임박재료 자동선택 <=3 필터를 못 넘는다). expiry도
  // 로컬 자정으로 맞춰야 순수한 "날짜 차이"만 남는다 - App.jsx/HomePage.jsx의 dDay 계산과 동일한 방식.
  const daysUntil = (expiryDateStr) => {
    const expiry = new Date(expiryDateStr);
    expiry.setHours(0, 0, 0, 0);
    return Math.ceil((expiry - today) / 86400000);
  };

  const sorted = [...pantryItems].sort((a, b) => {
    const da = daysUntil(a.expiry_date);
    const db = daysUntil(b.expiry_date);
    return da - db;
  });

  // 우선 사용 재료 표시용: 동일한 식재료명은 하나로만 표시 (가장 임박한 것 기준)
  const uniqueSorted = sorted.filter((item, idx) =>
    sorted.findIndex(i => i.item_name === item.item_name) === idx
  );

  useEffect(() => {
    fetch('/api/pantry', { credentials: 'include' })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setPantryItems(data); })
      .catch(() => {})
      .finally(() => setPantryLoading(false));
  }, []);

  // Auto-initialize priority set from expiry once pantry loads
  useEffect(() => {
    if (!pantryLoading && priorityItems === null) {
      const auto = new Set(
        pantryItems
          .filter(i => daysUntil(i.expiry_date) <= 3)
          .map(i => i.item_name)
      );
      setPriorityItems(auto);
    }
  }, [pantryLoading]);

  useEffect(() => {
    if (tab === 'saved') loadSaved();
    setExpandedIdx(null);
  }, [tab]);

  const togglePriority = (itemName) => {
    setPriorityItems(prev => {
      const next = new Set(prev);
      if (next.has(itemName)) next.delete(itemName);
      else next.add(itemName);
      return next;
    });
  };

  const loadSaved = () => {
    setSavedLoading(true);
    fetch('/api/recipes/saved', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSavedRecipes(data);
          const map = {};
          data.forEach(r => { map[r.recipe_name] = r.id; });
          setSavedMap(map);
        }
      })
      .catch(() => {})
      .finally(() => setSavedLoading(false));
  };

  // 같은 재료가 여러 배치(수량/유통기한 다름)로 등록돼 있어도 이름 기준 1건만 전송한다.
  // UI의 "N개 선택" 표시도 uniqueSorted 기준이므로 선택 개수와 전송 목록을 항상 일치시킨다.
  const orderedIngredients = priorityItems
    ? [
        ...uniqueSorted.filter(i => priorityItems.has(i.item_name)),
        ...uniqueSorted.filter(i => !priorityItems.has(i.item_name)),
      ].map(i => i.item_name)
    : uniqueSorted.map(i => i.item_name);

  const fetchRecipes = async () => {
    // 수정 전: if (ingredients.length === 0) return;
    if (orderedIngredients.length === 0) return;
    setLoading(true);
    setExpandedIdx(null);
    try {
      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // 수정 전: body: JSON.stringify({ ingredients }),
        body: JSON.stringify({
          ingredients: orderedIngredients,
          priorityIngredients: priorityItems ? [...priorityItems] : [],
        }),
      });
      if (!res.ok) {
        showToast('로그인이 만료됐거나 서비스에 일시적인 문제가 있어요. 잠시 후 다시 시도해주세요.');
        setRecipes([]);
        setFetched(true);
        return;
      }
      const data = await res.json();
      setRecipes(data.recipes || []);
      setFetched(true);
    } catch {
      showToast('네트워크 오류로 추천을 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
      setRecipes([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (recipe) => {
    const isSaved = savedMap[recipe.name] != null;
    if (isSaved) {
      const id = savedMap[recipe.name];
      await fetch(`/api/recipes/saved/${id}`, { method: 'DELETE', credentials: 'include' });
      setSavedMap(prev => { const m = { ...prev }; delete m[recipe.name]; return m; });
      showToast('찜 취소됐어요');
    } else {
      const res = await fetch('/api/recipes/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ recipe }),
      });
      const data = await res.json();
      if (data.success) {
        setSavedMap(prev => ({ ...prev, [recipe.name]: data.id }));
        showToast('레시피를 저장했어요 ♥');
      }
    }
  };

  const handleUnsaveFromSaved = async (id, recipeName) => {
    await fetch(`/api/recipes/saved/${id}`, { method: 'DELETE', credentials: 'include' });
    setSavedRecipes(prev => prev.filter(r => r.id !== id));
    setSavedMap(prev => { const m = { ...prev }; delete m[recipeName]; return m; });
    showToast('찜 취소됐어요');
  };

  const handleCook = (recipe) => {
    setCookTarget(recipe);
  };

  const handleCookConfirm = async (usages) => {
    setCookTarget(null);
    try {
      const res = await fetch('/api/pantry/cook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          used_ingredients: usages.map(u => ({
            name:           u.name,
            pantry_item_id: u.pantry_item_id,
            used_qty:       u.used_qty,
            unit:           u.unit,
          })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`맛있는 요리 되세요! 🍳 식재료 ${data.updatedCount}개 사용 처리`);
        fetch('/api/pantry', { credentials: 'include' })
          .then(r => r.json())
          .then(d => { if (Array.isArray(d)) setPantryItems(d); });
      }
    } catch {
      showToast('오류가 발생했어요');
    }
  };

  const urgentCount = uniqueSorted.filter(i => daysUntil(i.expiry_date) <= 3).length;

  const visibleItems = showAllIngredients ? uniqueSorted : uniqueSorted.slice(0, 12);

  return (
    <div className="flex flex-col h-full bg-white overflow-y-auto scrollbar-hide overscroll-none">
      {cookTarget && (
        <CookModal
          recipe={cookTarget}
          pantryItems={pantryItems}
          onClose={() => setCookTarget(null)}
          onConfirm={handleCookConfirm}
        />
      )}
      <div className="px-6 pt-6 pb-4">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-[26px] font-black text-gray-900 tracking-tight">오늘의 추천 🍽️</h2>
            <p className="text-gray-400 font-bold text-xs mt-1 uppercase tracking-widest">Recipe Recommendations</p>
          </div>
          {fetched && tab === 'recommend' && (
            <button onClick={fetchRecipes} disabled={loading}
              className="p-2.5 bg-gray-100 rounded-2xl text-gray-500 active:scale-90 transition-all disabled:opacity-40">
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
          )}
        </div>

        <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 mt-4">
          {['recommend', 'saved'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2.5 rounded-xl text-xs font-black transition-all ${tab === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400'}`}>
              {t === 'recommend' ? '추천 레시피' : '찜한 레시피'}
            </button>
          ))}
        </div>

        {/* 수정 전:
        {tab === 'recommend' && !pantryLoading && ingredients.length > 0 && (
          <div className="mt-4">
            {urgentCount > 0 && (
              <p className="text-xs text-red-500 font-bold flex items-center gap-1 mb-2">
                <AlertCircle size={12} /> 임박 재료 {urgentCount}개 우선 반영
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {sorted.slice(0, 10).map((item, i) => {
                const days = Math.ceil((new Date(item.expiry_date) - today) / 86400000);
                return (
                  <span key={i} className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                    days <= 3 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-gray-50 text-gray-500 border-gray-100'
                  }`}>
                    {item.item_emoji} {item.item_name}
                  </span>
                );
              })}
              {ingredients.length > 10 && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-gray-50 text-gray-400 border border-gray-100">
                  +{ingredients.length - 10}개
                </span>
              )}
            </div>
          </div>
        )}
        */}
        {tab === 'recommend' && !pantryLoading && uniqueSorted.length > 0 && priorityItems !== null && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                우선 사용 재료
              </p>
              <div className="flex items-center gap-2.5">
                {priorityItems.size > 0 && (
                  <span className="text-[10px] font-bold text-blue-500">{priorityItems.size}개 선택</span>
                )}
                <button
                  onClick={() => setPriorityItems(new Set(uniqueSorted.map(i => i.item_name)))}
                  className="text-[10px] font-bold text-gray-400 underline underline-offset-2"
                >
                  전체
                </button>
                <button
                  onClick={() => setPriorityItems(new Set())}
                  className="text-[10px] font-bold text-gray-400 underline underline-offset-2"
                >
                  해제
                </button>
              </div>
            </div>

            {urgentCount > 0 && (
              <p className="text-xs text-red-500 font-bold flex items-center gap-1 mb-2">
                <AlertCircle size={12} /> 임박 재료 {urgentCount}개 자동 선택됨 · 탭하여 변경
              </p>
            )}

            <div className="flex flex-wrap gap-1.5">
              {visibleItems.map((item, i) => {
                const days = daysUntil(item.expiry_date);
                const isPriority = priorityItems.has(item.item_name);
                const isUrgent = days <= 3;
                return (
                  <button
                    key={i}
                    onClick={() => togglePriority(item.item_name)}
                    className={`text-xs font-bold px-2.5 py-1 rounded-full border transition-all active:scale-95 ${
                      isPriority && isUrgent
                        ? 'bg-red-50 text-red-600 border-red-200 ring-1 ring-red-200'
                        : isPriority
                        ? 'bg-blue-50 text-blue-600 border-blue-200 ring-1 ring-blue-200'
                        : 'bg-gray-50 text-gray-400 border-gray-100'
                    }`}
                  >
                    <FoodIcon name={item.item_name} emoji={item.item_emoji} size={14} className="inline-block align-[-2px] mr-1" /> {item.item_name}
                    {isUrgent && (
                      <span className={`ml-1 text-[9px] font-black ${isPriority ? '' : 'opacity-50'}`}>
                        D-{days}
                      </span>
                    )}
                  </button>
                );
              })}
              {uniqueSorted.length > 12 && (
                <button
                  onClick={() => setShowAllIngredients(p => !p)}
                  className="text-xs font-bold px-2.5 py-1 rounded-full bg-gray-50 text-gray-400 border border-gray-100 active:scale-95 transition-all"
                >
                  {showAllIngredients ? '접기' : `+${uniqueSorted.length - 12}개`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="px-6 pb-32 space-y-5">
        {tab === 'recommend' ? (
          <>
            {!pantryLoading && sorted.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <p className="text-4xl mb-3">🥬</p>
                <p className="font-bold">냉장고가 비어있어요</p>
                <p className="text-sm mt-1">식재료를 먼저 등록해주세요</p>
              </div>
            )}
            {!fetched && !loading && sorted.length > 0 && (
              <button onClick={fetchRecipes}
                className="w-full py-5 bg-gray-900 text-white rounded-[28px] font-black text-base active:scale-[0.98] transition-all shadow-lg">
                🤖 보유 재료로 레시피 추천받기
              </button>
            )}
            {loading && (
              <div className="space-y-4">
                {[0, 1].map(i => (
                  <div key={i} className="rounded-[32px] bg-gray-50 border border-gray-100 overflow-hidden animate-pulse">
                    <div className="h-36 bg-gray-200" />
                    <div className="p-5 space-y-3">
                      <div className="h-5 bg-gray-200 rounded-full w-2/3" />
                      <div className="h-3 bg-gray-200 rounded-full w-1/3" />
                    </div>
                  </div>
                ))}
                <p className="text-center text-sm text-gray-400 font-bold pt-2">AI가 레시피를 생각하는 중... (최대 1분)</p>
              </div>
            )}
            {fetched && !loading && recipes.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <p className="font-bold mb-3">추천을 불러오지 못했어요, 다시 시도해주세요</p>
                <button onClick={fetchRecipes} className="text-sm font-bold text-gray-900 underline">다시 시도</button>
              </div>
            )}
            {!loading && recipes.map((recipe, idx) => (
              <RecipeCard key={idx} recipe={recipe} idx={idx}
                isBookmarked={savedMap[recipe.name] != null}
                onToggleSave={() => handleSave(recipe)}
                onCook={() => handleCook(recipe)}
                expandedIdx={expandedIdx}
                setExpandedIdx={setExpandedIdx}
              />
            ))}
          </>
        ) : (
          <>
            {savedLoading ? (
              <div className="text-center py-12 text-gray-400">
                <p className="text-sm font-bold">불러오는 중...</p>
              </div>
            ) : savedRecipes.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <p className="text-4xl mb-3">🤍</p>
                <p className="font-bold">저장된 레시피가 없어요</p>
                <p className="text-sm mt-1">마음에 드는 레시피를 찜해보세요</p>
              </div>
            ) : (
              savedRecipes.map((saved, idx) => {
                const recipe = saved.recipe_json;
                return (
                  <RecipeCard key={saved.id} recipe={recipe} idx={idx}
                    isBookmarked={true}
                    onToggleSave={() => handleUnsaveFromSaved(saved.id, recipe.name)}
                    onCook={() => handleCook(recipe)}
                    expandedIdx={expandedIdx}
                    setExpandedIdx={setExpandedIdx}
                  />
                );
              })
            )}
          </>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm font-bold px-5 py-3 rounded-2xl shadow-lg z-50 whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
};

export default RecipePage;
