import React, { useState, useEffect } from 'react';
import { Plus, X, Minus, Trash2, CheckCircle2, Circle, Pencil } from 'lucide-react';
import FoodIcon from '../components/FoodIcon';
import { formatPantryQuantity } from '../utils/quantityFormat';

const MainPage = () => {
  const [activeTab, setActiveTab]         = useState('전체');
  const [activeFoodTab, setActiveFoodTab] = useState('전체');
  const [isModalOpen, setIsModalOpen]     = useState(false);
  const [loading, setLoading]             = useState(true);
  const [isDeleteMode, setIsDeleteMode]   = useState(false);
  const [selectedItems, setSelectedItems] = useState([]);
  const [newItem, setNewItem]             = useState({ name: '', date: '', category: '냉장', quantity: 1, unit: '개' });
  const [pantryItems, setPantryItems]     = useState([]);

  // 수정 모달
  const [editItem, setEditItem]       = useState(null);
  const [editQty, setEditQty]         = useState(1);
  const [editDate, setEditDate]       = useState('');
  const [deleteCount, setDeleteCount] = useState(1);
  const [editSaving, setEditSaving]   = useState(false);

  const fetchItems = async () => {
    try {
      const response = await fetch('/api/pantry', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        const mappedData = data.map(item => ({
          id:           item.id,
          name:         item.item_name,
          date:         item.expiry_date.split('T')[0].replace(/-/g, '.'),
          rawDate:      item.expiry_date.split('T')[0],
          category:     item.category     || '냉장',
          foodCategory: item.food_category || null,
          icon:         item.item_emoji   || getIcon(item.item_name),
          color:        getBgColor(item.category || '냉장'),
          quantity:     parseFloat(item.quantity) || 1,
          unit:         item.unit || '개',
        }));
        setPantryItems(mappedData);
      }
    } catch (error) {
      console.error('데이터 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchItems(); }, []);

  const openEditModal = (item) => {
    setEditItem(item);
    setEditQty(Math.round(item.quantity));
    setEditDate(item.rawDate);
    setDeleteCount(1);
  };

  const handleSaveEdit = async () => {
    setEditSaving(true);
    try {
      await fetch(`/api/pantry/${editItem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ quantity: editQty, expiry_date: editDate }),
      });
      setEditItem(null);
      fetchItems();
    } catch { alert('수정 중 오류가 발생했습니다.'); }
    finally { setEditSaving(false); }
  };

  const handleEditDelete = async () => {
    const remaining = editItem.quantity - deleteCount;
    setEditSaving(true);
    try {
      if (remaining <= 0) {
        await fetch(`/api/delete-item/${editItem.id}`, { method: 'DELETE', credentials: 'include' });
      } else {
        await fetch(`/api/pantry/${editItem.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ quantity: remaining }),
        });
      }
      setEditItem(null);
      fetchItems();
    } catch { alert('삭제 중 오류가 발생했습니다.'); }
    finally { setEditSaving(false); }
  };

  const toggleSelectItem = (id) => {
    setSelectedItems(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleDeleteSelected = async () => {
    if (!selectedItems.length) return;
    if (!window.confirm(`${selectedItems.length}개의 항목을 삭제하시겠습니까?`)) return;
    try {
      const response = await fetch('/api/delete-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ids: selectedItems }),
      });
      if (response.ok) { setSelectedItems([]); setIsDeleteMode(false); fetchItems(); }
    } catch { alert('삭제 중 오류가 발생했습니다.'); }
  };

  const getBgColor = (category) => {
    switch (category) {
      case '냉동': return 'bg-purple-50';
      case '실온': return 'bg-orange-50';
      default:     return 'bg-blue-50';
    }
  };

  const getCategoryStyle = (category) => {
    switch (category) {
      case '냉장': return 'bg-blue-50 text-blue-500 border-blue-100';
      case '냉동': return 'bg-purple-50 text-purple-500 border-purple-100';
      case '실온': return 'bg-orange-50 text-orange-500 border-orange-100';
      default:     return 'bg-gray-50 text-gray-500 border-gray-100';
    }
  };

  const getDiffDays = (targetDate) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // "YYYY-MM-DD" 형태의 날짜 전용 문자열은 UTC 자정으로 파싱된다(KST 기준 오전 9시) -
    // 로컬 자정인 today와 그대로 빼면 9시간이 남아 Math.ceil이 하루를 더 얹는다
    // (실제 D-3인 재료가 D-4로 표시됨). target도 로컬 자정으로 맞춰야 한다.
    const target = new Date(targetDate.replace(/\./g, '-'));
    target.setHours(0, 0, 0, 0);
    return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
  };

  const getSpectrumStyle = (diffDays) => {
    const ratio = Math.max(0, Math.min(diffDays, 14)) / 14;
    const hue = ratio * 120;
    return {
      backgroundColor: `hsla(${hue}, 90%, 55%, 0.15)`,
      color: `hsl(${hue}, 100%, 25%)`,
      border: `1px solid hsla(${hue}, 90%, 45%, 0.3)`,
    };
  };

  const getIcon = (name) => {
    if (name.includes('우유')) return '🥛';
    if (name.includes('고기') || name.includes('소') || name.includes('돼지')) return '🥩';
    if (name.includes('사과')) return '🍎';
    if (name.includes('만두')) return '🥟';
    return '📦';
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/add-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          item_name:   newItem.name,
          expiry_date: newItem.date,
          item_emoji:  getIcon(newItem.name),
          category:    newItem.category,
          quantity:    newItem.quantity,
          unit:        newItem.unit,
        }),
      });
      if (response.ok) {
        setIsModalOpen(false);
        setNewItem({ name: '', date: '', category: '냉장', quantity: 1, unit: '개' });
        fetchItems();
      }
    } catch { alert('저장 중 오류가 발생했습니다.'); }
  };

  const sortedItems = [...pantryItems].sort((a, b) =>
    new Date(a.date.replace(/\./g, '-')) - new Date(b.date.replace(/\./g, '-'))
  );

  const filteredItems = sortedItems
    .filter(item => activeTab === '전체'     || item.category     === activeTab)
    .filter(item => activeFoodTab === '전체' || item.foodCategory === activeFoodTab);

  if (loading) return <div className="p-10 text-center font-bold text-gray-500">식재료 불러오는 중...</div>;

  return (
    <div className="flex flex-col h-full bg-white overflow-y-auto scrollbar-hide overscroll-none relative">

      {/* 헤더 */}
      <div className="px-5 pt-4 mb-6 flex justify-between items-end">
        <div>
          <h2 className="text-[28px] font-black text-gray-900 leading-tight">내 냉장고</h2>
          <p className="text-gray-400 font-medium text-sm mt-1">
            {isDeleteMode ? `${selectedItems.length}개 선택됨` : `총 ${filteredItems.length}개 식재료`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setIsDeleteMode(!isDeleteMode); setSelectedItems([]); }}
            className={`p-3 rounded-2xl shadow-lg active:scale-90 transition-all ${
              isDeleteMode ? 'bg-red-500 text-white' : 'bg-white text-gray-400 border border-gray-100'
            }`}
          >
            {isDeleteMode ? <X size={24} /> : <Minus size={24} />}
          </button>
          {!isDeleteMode && (
            <button onClick={() => setIsModalOpen(true)} className="p-3 bg-gray-900 text-white rounded-2xl shadow-lg active:scale-90 transition-transform">
              <Plus size={24} />
            </button>
          )}
        </div>
      </div>

      {/* 탭 */}
      <div className="sticky top-0 bg-white z-10 px-5 pb-4 space-y-2">
        <div className="flex gap-2 overflow-x-auto flex-nowrap scrollbar-hide pb-1">
          {['전체', '냉장', '냉동', '실온'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-2.5 rounded-full font-bold text-sm shrink-0 transition-all ${
                activeTab === tab ? 'bg-gray-900 text-white shadow-md' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto flex-nowrap scrollbar-hide pb-1">
          {['전체', '채소류', '과일류', '육류', '수산물', '유제품·계란', '두부·콩류',
            '가공·즉석식품', '음료·주류', '양념·소스', '곡류·면류', '스낵·과자'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveFoodTab(tab)}
              className={`px-4 py-1.5 rounded-full font-bold text-xs shrink-0 transition-all ${
                activeFoodTab === tab ? 'bg-green-600 text-white shadow-md' : 'bg-green-50 text-green-600'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* 식재료 리스트 */}
      <div className="px-5 pb-32 space-y-4">
        {filteredItems.length === 0 ? (
          <div className="text-center py-20 text-gray-400 font-bold">저장고가 비어있습니다.</div>
        ) : (
          filteredItems.map(item => {
            const diffDays = getDiffDays(item.date);
            const dDayLabel = diffDays === 0 ? 'D-Day' : diffDays < 0 ? `D+${Math.abs(diffDays)}` : `D-${diffDays}`;
            const spectrumStyle = getSpectrumStyle(diffDays);
            const isSelected = selectedItems.includes(item.id);

            return (
              <div
                key={item.id}
                onClick={() => {
                  if (isDeleteMode) toggleSelectItem(item.id);
                  else openEditModal(item);
                }}
                className={`flex items-center p-4 bg-white rounded-[30px] border transition-all duration-200 active:scale-[0.98] ${
                  isSelected ? 'border-blue-500 bg-blue-50/50 scale-[0.98]' : 'border-gray-100'
                } cursor-pointer`}
              >
                {isDeleteMode && (
                  <div className="mr-3 animate-in fade-in slide-in-from-left-2">
                    {isSelected
                      ? <CheckCircle2 size={24} className="text-blue-500" />
                      : <Circle size={24} className="text-gray-200" />
                    }
                  </div>
                )}

                <div className={`w-16 h-16 ${item.color} rounded-[22px] flex items-center justify-center text-3xl mr-4 shrink-0`}>
                  <FoodIcon name={item.name} emoji={item.icon} size={36} />
                </div>

                {/* ── 텍스트 영역 ── */}
                <div className="flex-1 min-w-0">
                  {/* 1줄: 식재료 이름 */}
                  <p className="font-bold text-gray-900 text-[17px] truncate mb-1">{item.name}</p>
                  {/* 2줄: 갯수 · 카테고리 · 보관방법 */}
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-gray-100 text-gray-600 shrink-0">
                      {formatPantryQuantity(item.quantity, item.unit)}
                    </span>
                    {item.foodCategory && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold border bg-green-50 text-green-600 border-green-200 shrink-0">
                        {item.foodCategory}
                      </span>
                    )}
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border shrink-0 ${getCategoryStyle(item.category)}`}>
                      {item.category}
                    </span>
                  </div>
                  {/* 3줄: 소비기한 */}
                  <p className="text-[11px] text-gray-400 font-semibold tracking-tight">
                    소비기한 {item.date}
                  </p>
                </div>

                {!isDeleteMode && (
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <div style={spectrumStyle} className="px-4 py-1.5 rounded-full text-[13px] font-black">
                      {dDayLabel}
                    </div>
                    <Pencil size={14} className="text-gray-300" />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 배치 삭제 버튼 */}
      {isDeleteMode && selectedItems.length > 0 && (
        <div className="fixed bottom-28 left-0 right-0 px-6 z-[100] flex justify-center animate-in slide-in-from-bottom-10 duration-300">
          <button
            onClick={handleDeleteSelected}
            className="w-full max-w-[400px] py-5 bg-red-500 text-white rounded-[26px] font-black text-lg shadow-[0_10px_30px_rgba(239,68,68,0.4)] flex items-center justify-center gap-2 active:scale-95 transition-all"
          >
            <Trash2 size={22} />
            <span>{selectedItems.length}개 식재료 삭제하기</span>
          </button>
        </div>
      )}

      {/* 수정 모달 */}
      {editItem && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-[430px] bg-white rounded-t-[40px] px-6 pt-6 pb-10 shadow-2xl">

            <div className="flex justify-between items-center mb-5">
              <div className="flex items-center gap-2">
                <FoodIcon name={editItem.name} emoji={editItem.icon} size={28} className="text-2xl" />
                <div>
                  <p className="text-lg font-black text-gray-900">{editItem.name}</p>
                  <p className="text-xs text-gray-400 font-medium">{editItem.category}</p>
                </div>
              </div>
              <button onClick={() => setEditItem(null)} className="p-2 rounded-full bg-gray-100 text-gray-500">
                <X size={20} />
              </button>
            </div>

            {/* 수량 수정 */}
            <div className="mb-5">
              <p className="text-xs font-black text-gray-400 mb-2">수량</p>
              <div className="flex items-center gap-4 bg-gray-50 rounded-2xl px-5 py-3">
                <button
                  onClick={() => setEditQty(q => Math.max(1, q - 1))}
                  className="w-9 h-9 rounded-full bg-white shadow flex items-center justify-center text-gray-700 font-black active:scale-90 transition-all"
                >
                  <Minus size={16} />
                </button>
                <span className="flex-1 text-center text-xl font-black text-gray-900">
                  {editQty}<span className="text-base text-gray-400 ml-1">{editItem.unit}</span>
                </span>
                <button
                  onClick={() => setEditQty(q => q + 1)}
                  className="w-9 h-9 rounded-full bg-white shadow flex items-center justify-center text-gray-700 font-black active:scale-90 transition-all"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            {/* 소비기한 수정 */}
            <div className="mb-5">
              <p className="text-xs font-black text-gray-400 mb-2">소비기한</p>
              <input
                type="date"
                value={editDate}
                onChange={e => setEditDate(e.target.value)}
                className="w-full p-4 bg-gray-50 rounded-2xl font-bold text-gray-900 outline-none"
              />
            </div>

            {/* 저장 버튼 */}
            <button
              onClick={handleSaveEdit}
              disabled={editSaving}
              className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black mb-5 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {editSaving ? '저장 중...' : '저장'}
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-gray-100" />
              <p className="text-xs font-black text-gray-300">삭제</p>
              <div className="flex-1 h-px bg-gray-100" />
            </div>

            {editItem.quantity > 1 ? (
              <div>
                <p className="text-xs font-bold text-gray-400 mb-2">몇 개 버릴까요?</p>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-3 bg-gray-50 rounded-2xl px-4 py-2.5 flex-1">
                    <button
                      onClick={() => setDeleteCount(c => c <= 1 ? Math.round(editItem.quantity) : c - 1)}
                      className="w-8 h-8 rounded-full bg-white shadow flex items-center justify-center text-gray-600 active:scale-90 transition-all"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="flex-1 text-center font-black text-gray-900">
                      {deleteCount}<span className="text-xs text-gray-400 ml-1">{editItem.unit}</span>
                      {deleteCount >= editItem.quantity && <span className="text-xs text-red-400 ml-1">(전부)</span>}
                    </span>
                    <button
                      onClick={() => setDeleteCount(c => Math.min(Math.round(editItem.quantity), c + 1))}
                      className="w-8 h-8 rounded-full bg-white shadow flex items-center justify-center text-gray-600 active:scale-90 transition-all"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  <button
                    onClick={handleEditDelete}
                    disabled={editSaving}
                    className="px-5 py-3 bg-red-500 text-white rounded-2xl font-black flex items-center gap-1.5 active:scale-[0.98] transition-all disabled:opacity-50 shrink-0"
                  >
                    <Trash2 size={15} /> 버리기
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleEditDelete}
                disabled={editSaving}
                className="w-full py-3.5 bg-red-50 text-red-500 rounded-2xl font-black flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                <Trash2 size={16} /> 삭제
              </button>
            )}
          </div>
        </div>
      )}

      {/* 등록 모달 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-[400px] bg-white rounded-[40px] p-8 shadow-2xl animate-in slide-in-from-bottom duration-300">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-black text-gray-900">식재료 직접 등록</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400"><X size={24} /></button>
            </div>
            <form onSubmit={handleAddItem} className="space-y-5">
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 ml-1">품목 명</label>
                <input
                  type="text" required placeholder="예: 신선한 우유"
                  className="w-full p-4 bg-gray-100 rounded-2xl border-none font-bold outline-none"
                  value={newItem.name}
                  onChange={e => setNewItem({...newItem, name: e.target.value})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 ml-1">소비기한</label>
                <input
                  type="date" required
                  className="w-full p-4 bg-gray-100 rounded-2xl border-none font-bold outline-none"
                  value={newItem.date}
                  onChange={e => setNewItem({...newItem, date: e.target.value})}
                />
                <div className="flex gap-2 pt-1">
                  {[['+ 1주', 0, 7, 0], ['+ 1달', 1, 0, 0], ['+ 1년', 0, 0, 1]].map(([label, m, d, y]) => (
                    <button
                      key={label} type="button"
                      onClick={() => {
                        const dt = newItem.date ? new Date(newItem.date + 'T00:00:00') : new Date();
                        dt.setDate(dt.getDate() + d);
                        dt.setMonth(dt.getMonth() + m);
                        dt.setFullYear(dt.getFullYear() + y);
                        setNewItem(p => ({ ...p, date: dt.toISOString().split('T')[0] }));
                      }}
                      className="flex-1 py-2 bg-gray-100 text-gray-500 rounded-xl text-xs font-bold active:scale-95 transition-all"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 ml-1">수량</label>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-3 bg-gray-100 rounded-2xl px-4 py-3 flex-1">
                    <button
                      type="button"
                      onClick={() => setNewItem(p => ({ ...p, quantity: Math.max(1, p.quantity - 1) }))}
                      className="w-8 h-8 rounded-full bg-white shadow flex items-center justify-center text-gray-700 active:scale-90 transition-all"
                    >
                      <Minus size={15} />
                    </button>
                    <span className="flex-1 text-center text-xl font-black text-gray-900">{newItem.quantity}</span>
                    <button
                      type="button"
                      onClick={() => setNewItem(p => ({ ...p, quantity: p.quantity + 1 }))}
                      className="w-8 h-8 rounded-full bg-white shadow flex items-center justify-center text-gray-700 active:scale-90 transition-all"
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
                    {['개', 'g', 'kg', 'ml'].map(u => (
                      <button
                        key={u} type="button"
                        onClick={() => setNewItem(p => ({ ...p, unit: u }))}
                        className={`px-3 py-2 rounded-xl text-xs font-bold shrink-0 transition-all ${
                          newItem.unit === u ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 ml-1">보관 장소</label>
                <div className="flex gap-2">
                  {['냉장', '냉동', '실온'].map(cat => (
                    <button
                      key={cat} type="button"
                      onClick={() => setNewItem({...newItem, category: cat})}
                      className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${
                        newItem.category === cat ? 'bg-gray-900 text-white shadow-md' : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
              <button type="submit" className="w-full py-5 bg-blue-600 text-white rounded-[22px] font-black text-lg mt-4 active:scale-95 transition-all shadow-lg">
                저장고에 넣기
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MainPage;