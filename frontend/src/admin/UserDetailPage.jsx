import React, { useState, useEffect } from 'react';
import { X, AlertTriangle } from 'lucide-react';

const TABS = ['기본 정보', '저장고', '추천 로그'];

const getDiffStyle = (d) => {
  if (d <= 0)  return 'bg-red-50 text-red-600 border-red-100';
  if (d <= 3)  return 'bg-orange-50 text-orange-500 border-orange-100';
  if (d <= 7)  return 'bg-yellow-50 text-yellow-600 border-yellow-100';
  return 'bg-green-50 text-green-600 border-green-100';
};
const getDiffLabel = (d) => d <= 0 ? `D+${Math.abs(d)}` : `D-${d}`;

const UserDetailPage = ({ user, onClose, onDeleted }) => {
  const [tab, setTab]             = useState('기본 정보');
  const [confirmDelete, setConfirm] = useState(false);
  const [pantry, setPantry]       = useState([]);
  const [logs, setLogs]           = useState([]);
  const [deleting, setDeleting]   = useState(false);

  useEffect(() => {
    if (!user) return;
    setTab('기본 정보'); setConfirm(false);
    fetch(`/api/admin/users/${user.id}/pantry`, { credentials: 'include' })
      .then(r => r.json()).then(d => setPantry(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`/api/admin/users/${user.id}/logs`, { credentials: 'include' })
      .then(r => r.json()).then(d => setLogs(Array.isArray(d) ? d : [])).catch(() => {});
  }, [user?.id]);

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirm(true); return; }
    setDeleting(true);
    const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE', credentials: 'include' });
    const data = await res.json();
    if (data.success) onDeleted?.(user.id);
    else { alert('삭제 실패'); setDeleting(false); setConfirm(false); }
  };

  if (!user) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
        <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-sm font-black text-blue-500 shrink-0">
          {user.name?.[0] || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-gray-900">{user.name}</p>
          <p className="text-xs text-gray-400 truncate">{user.email || user.provider || '—'}</p>
        </div>
        <button onClick={onClose} className="p-1 text-gray-300 hover:text-gray-600">
          <X size={16} />
        </button>
      </div>

      {/* 탭 */}
      <div className="flex border-b border-gray-100 shrink-0">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-xs font-bold transition-colors ${tab === t ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-300'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 기본 정보 */}
        {tab === '기본 정보' && (
          <div className="px-4 py-4 space-y-3">
            {[
              ['ID',       user.id],
              ['이름',     user.name],
              ['이메일',   user.email || '—'],
              ['로그인',   user.provider],
              ['가입일',   user.created_at?.split('T')[0]],
              ['최근 로그인', user.last_login_at?.split('T')[0] || '—'],
              ['식재료 수', `${user.pantry_count || 0}개`],
              ['약관 동의', user.is_agreed ? '동의' : '미동의'],
              ['관리자',   user.is_admin ? '예' : '아니오'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between items-start gap-2">
                <span className="text-xs text-gray-400 shrink-0">{k}</span>
                <span className="text-xs font-bold text-gray-900 text-right break-all">{v}</span>
              </div>
            ))}
          </div>
        )}

        {/* 저장고 */}
        {tab === '저장고' && (
          <div className="px-4 py-4 space-y-2.5">
            {pantry.length === 0
              ? <p className="text-xs text-gray-400 text-center py-8">등록된 식재료 없음</p>
              : pantry.map(item => {
                const expiry = new Date(item.expiry_date);
                expiry.setHours(0, 0, 0, 0);
                const days = Math.ceil((expiry - today) / 86400000);
                return (
                  <div key={item.id} className="flex items-center gap-2.5">
                    <span className="text-lg shrink-0">{item.item_emoji || '📦'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-900 truncate">{item.item_name}</p>
                      <p className="text-[10px] text-gray-400">{item.expiry_date?.split('T')[0]} · {item.category}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${getDiffStyle(days)}`}>
                      {getDiffLabel(days)}
                    </span>
                  </div>
                );
              })
            }
          </div>
        )}

        {/* 추천 로그 */}
        {tab === '추천 로그' && (
          <div className="px-4 py-4 space-y-3">
            {logs.length === 0
              ? <p className="text-xs text-gray-400 text-center py-8">추천 이력 없음</p>
              : logs.map(log => (
                <div key={log.id} className="border-b border-gray-50 pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] bg-gray-100 text-gray-500 font-bold px-2 py-0.5 rounded-full">
                      {log.recommendation_type}
                    </span>
                    <span className="text-[10px] text-gray-400 ml-auto">{log.created_at?.split('T')[0]}</span>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">{log.input_ingredients}</p>
                </div>
              ))
            }
          </div>
        )}
      </div>

      {/* 삭제 버튼 */}
      <div className="px-4 py-3 border-t border-gray-100 shrink-0">
        {confirmDelete && (
          <div className="flex items-center gap-1.5 text-xs text-red-500 mb-2 bg-red-50 rounded-xl px-3 py-2">
            <AlertTriangle size={12} /> 정말 삭제하시겠습니까?
          </div>
        )}
        <div className="flex gap-2">
          {confirmDelete && (
            <button onClick={() => setConfirm(false)}
              className="flex-1 h-9 rounded-xl text-xs font-bold border border-gray-100 text-gray-400">
              취소
            </button>
          )}
          <button onClick={handleDelete} disabled={deleting}
            className={`flex-1 h-9 rounded-xl text-xs font-black transition-all disabled:opacity-50
              ${confirmDelete ? 'bg-red-500 text-white' : 'bg-red-50 text-red-500 border border-red-100'}`}>
            {deleting ? '삭제 중...' : confirmDelete ? '최종 삭제' : '계정 삭제'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserDetailPage;
