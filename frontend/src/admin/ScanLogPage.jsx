import React, { useState, useEffect } from 'react';
import { RefreshCw, X, CheckCircle, XCircle, Trash2 } from 'lucide-react';

const MODE_LABEL = { food: '식재료', receipt: '영수증' };
const MODE_COLOR = { food: 'bg-green-50 text-green-600 border-green-100', receipt: 'bg-blue-50 text-blue-600 border-blue-100' };

const ScanLogPage = () => {
  const [logs, setLogs]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageLoading, setImageLoading]   = useState(false);
  const [filter, setFilter]       = useState('전체');
  const [deletingId, setDeletingId] = useState(null);

  const load = () => {
    setLoading(true);
    fetch('/api/admin/scan-logs', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setLogs(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(load, []);

  // 목록엔 용량 문제로 image_data가 없어서(has_image만 있음), 로그를 선택할 때 그 한 건의
  // 이미지만 별도 엔드포인트로 가져온다.
  useEffect(() => {
    setSelectedImage(null);
    if (!selected?.has_image) return;
    setImageLoading(true);
    fetch(`/api/admin/scan-logs/${selected.id}/image`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setSelectedImage(d.image_data || null))
      .catch(() => setSelectedImage(null))
      .finally(() => setImageLoading(false));
  }, [selected?.id]);

  const handleDelete = async (id) => {
    if (!window.confirm('이 스캔 로그를 삭제하시겠습니까?')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/scan-logs/${id}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setLogs(prev => prev.filter(l => l.id !== id));
        setSelected(prev => (prev?.id === id ? null : prev));
      } else {
        alert(data.message || '삭제에 실패했습니다.');
      }
    } catch {
      alert('삭제 중 오류가 발생했습니다.');
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = logs.filter(l => {
    if (filter === '전체') return true;
    if (filter === '식재료') return l.mode === 'food';
    if (filter === '영수증') return l.mode === 'receipt';
    if (filter === '성공') return l.status === 'success';
    if (filter === '실패') return l.status === 'failed';
    return true;
  });

  const TABS = ['전체', '식재료', '영수증', '성공', '실패'];

  return (
    <div className="flex flex-col h-full">
      {/* 상단 바 */}
      <div className="h-11 flex items-center justify-between px-6 bg-white border-b border-slate-100 shadow-sm shrink-0">
        <span className="text-base font-black text-slate-800">스캔 로그</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 font-medium">{logs.length}건</span>
          <button onClick={load} disabled={loading}
            className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-xl disabled:opacity-40">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-1 px-4 py-2 border-b border-gray-50 shrink-0">
        {TABS.map(t => (
          <button key={t} onClick={() => setFilter(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
              filter === t ? 'bg-gray-900 text-white' : 'text-gray-400 hover:bg-gray-50'
            }`}>{t}</button>
        ))}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 목록 */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <RefreshCw size={18} className="text-gray-300 animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-center py-16 text-xs text-gray-300">로그가 없습니다</p>
            ) : (
              filtered.map(log => (
                <div key={log.id} role="button" tabIndex={0} onClick={() => setSelected(selected?.id === log.id ? null : log)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 border-b border-gray-50 transition-colors text-left cursor-pointer group
                    ${selected?.id === log.id ? 'bg-blue-50/40' : 'hover:bg-gray-50'}`}>
                  {/* 썸네일 - 목록에서는 용량 문제로 실제 이미지를 안 불러오고 아이콘만 표시,
                      실제 사진은 상세 패널에서 선택 시 개별 조회 */}
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-gray-100 shrink-0 flex items-center justify-center">
                    <span className="text-xl">{log.mode === 'food' ? '🥦' : '🧾'}</span>
                  </div>

                  {/* 정보 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${MODE_COLOR[log.mode]}`}>
                        {MODE_LABEL[log.mode]}
                      </span>
                      {log.status === 'success'
                        ? <CheckCircle size={12} className="text-green-500" />
                        : <XCircle size={12} className="text-red-400" />
                      }
                      <span className="text-[10px] text-gray-400 ml-auto shrink-0">
                        {log.created_at?.replace('T', ' ').slice(0, 16)}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-gray-900 truncate">{log.user_name}</p>
                    <p className="text-[10px] text-gray-400 truncate">{log.user_email || '이메일 없음'}</p>
                  </div>

                  {/* 인식 수 */}
                  <div className="text-right shrink-0">
                    <p className="text-sm font-black text-gray-900">{log.item_count}</p>
                    <p className="text-[10px] text-gray-400">개 인식</p>
                  </div>

                  {/* 삭제 버튼 */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(log.id); }}
                    disabled={deletingId === log.id}
                    className="shrink-0 p-1.5 rounded-lg text-gray-300 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40"
                    title="삭제">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 상세 패널 */}
        {selected && (
          <div className="w-72 shrink-0 border-l border-gray-100 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
              <p className="text-sm font-black text-gray-900">스캔 상세</p>
              <div className="flex items-center gap-1">
                <button onClick={() => handleDelete(selected.id)} disabled={deletingId === selected.id}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40" title="삭제">
                  <Trash2 size={15} />
                </button>
                <button onClick={() => setSelected(null)}><X size={16} className="text-gray-400" /></button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {/* 이미지 - 목록 응답엔 없어서 선택 시 개별 조회한 selectedImage를 사용 */}
              <div className="w-full aspect-square rounded-2xl overflow-hidden bg-gray-100 flex items-center justify-center">
                {imageLoading
                  ? <RefreshCw size={20} className="text-gray-300 animate-spin" />
                  : selectedImage
                    ? <img src={selectedImage.startsWith('data:') ? selectedImage : `data:image/jpeg;base64,${selectedImage}`}
                        alt="scan" className="w-full h-full object-cover" />
                    : <span className="text-4xl">{selected.mode === 'food' ? '🥦' : '🧾'}</span>
                }
              </div>

              {/* 메타 */}
              <div className="space-y-2">
                {[
                  ['사용자',   selected.user_name],
                  ['이메일',   selected.user_email || '—'],
                  ['모드',     MODE_LABEL[selected.mode]],
                  ['소스',     selected.source],
                  ['인식 수',  `${selected.item_count}개`],
                  ['상태',     selected.status],
                  ['시각',     selected.created_at?.replace('T', ' ').slice(0, 16)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-xs text-gray-400">{k}</span>
                    <span className="text-xs font-bold text-gray-900">{v}</span>
                  </div>
                ))}
              </div>

              {/* 인식된 식재료 */}
              {selected.items_json && (
                <div>
                  <p className="text-xs font-black text-gray-400 mb-2">인식된 항목</p>
                  <div className="space-y-1.5">
                    {(() => {
                      try {
                        const items = typeof selected.items_json === 'string'
                          ? JSON.parse(selected.items_json) : selected.items_json;
                        return items.map((it, i) => (
                          <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                            <span className="text-base">{it.emoji || '📦'}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-gray-900 truncate">{it.name}</p>
                              <p className="text-[10px] text-gray-400">{it.storage} · {it.use_by}</p>
                            </div>
                          </div>
                        ));
                      } catch { return <p className="text-xs text-gray-400">파싱 실패</p>; }
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScanLogPage;
