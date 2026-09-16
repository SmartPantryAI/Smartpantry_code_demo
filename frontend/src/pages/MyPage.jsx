import React from 'react';
import { User, LogOut } from 'lucide-react';

const MyPage = ({ userName, onLogout }) => {
  return (
    <div className="flex-1 bg-gray-50 overflow-y-auto">
      {/* 프로필 섹션 */}
      <div className="bg-white p-8 pt-12 rounded-b-[40px] shadow-sm mb-6 text-center">
        <div className="w-24 h-24 bg-gray-900 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
          <User size={48} className="text-white" />
        </div>
        <h2 className="text-2xl font-black text-gray-900">{userName || '유저'}님</h2>
        <p className="text-gray-500 text-sm mt-1">스마트하게 냉장고를 관리 중입니다 🥬</p>
      </div>

      {/* 설정 메뉴 리스트 */}
      <div className="px-6 space-y-3">
        <p className="text-xs font-bold text-gray-400 ml-2 mb-1 uppercase tracking-wider">계정 관리</p>
        <button
          onClick={onLogout}
          className="w-full bg-white p-5 rounded-[32px] flex items-center gap-4 shadow-sm border border-gray-100 text-red-500 hover:bg-red-50 transition-colors active:scale-[0.98]"
        >
          <LogOut size={20} />
          <span className="font-bold">로그아웃</span>
        </button>
      </div>

      <div className="h-20" />
    </div>
  );
};

export default MyPage;
