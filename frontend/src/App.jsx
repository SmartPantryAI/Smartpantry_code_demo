import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, User, Camera, ShoppingBasket, Sparkles, Home } from 'lucide-react';
import MainPage from './pages/MainPage';
import ScanResultPage from './pages/ScanResultPage';
import HomePage from './pages/HomePage';
import RecipePage from './pages/RecipePage';
import MyPage from './pages/MyPage';
import TermsPage from './pages/TermsPage';
import ExpiredItemsModal from './components/ExpiredItemsModal';
import InstallPwaBanner from './components/InstallPwaBanner';

function App() {
  const [view, setView]                         = useState('home');
  const [isCameraOpen, setIsCameraOpen]         = useState(false);
  const [capturedImg, setCapturedImg]           = useState(null);
  const [user, setUser]                         = useState(null);
  const [loading, setLoading]                   = useState(true);
  const [scanMode, setScanMode]                 = useState('food');
  const [pantryItems, setPantryItems]           = useState([]);
  const [expiredDismissed, setExpiredDismissed] = useState(false);

  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const fetchPantry = () => {
    fetch('/api/pantry', { credentials: 'include' })
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setPantryItems(data); })
      .catch(console.error);
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiredItems = pantryItems
    .filter(item => item.status === 'available')
    .map(item => {
      const expiry = new Date(item.expiry_date);
      expiry.setHours(0, 0, 0, 0);
      return { ...item, dDay: Math.ceil((expiry - today) / 86400000) };
    })
    .filter(item => item.dDay < 0);

  const handleDiscardExpired = async (ids) => {
    await Promise.all(ids.map(id =>
      fetch(`/api/pantry/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'expired' }),
      })
    ));
    fetchPantry();
    setExpiredDismissed(true);
  };

  useEffect(() => {
    fetch('/api/user', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.loggedIn) {
          setUser({ name: data.user, isAgreed: Number(data.isAgreed), consents: data.consents || {} });
          fetchPantry();
        }
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(console.error);
    }
  }, []);

  useEffect(() => {
    if (view === 'home' && user) fetchPantry();
  }, [view]);

  const handleAgree = async (consents) => {
    try {
      const res = await fetch('/api/agree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ consents }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const userRes  = await fetch('/api/user', { credentials: 'include' });
        const userData = await userRes.json();
        setUser({ name: userData.user, isAgreed: Number(userData.isAgreed), consents: userData.consents || {} });
        setView('home');
      } else {
        alert("동의 처리에 실패했습니다.");
      }
    } catch (err) {
      alert("서버 통신 에러");
    }
  };

  // 카메라 스트림 시작 (mode별 해상도)
  const startStream = async (mode) => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width:  { ideal: mode === 'receipt' ? 4096 : 1280 },
        height: { ideal: mode === 'receipt' ? 3072 : 720  },
      }
    });
    streamRef.current = stream;
    if (videoRef.current) videoRef.current.srcObject = stream;
  };

  const openCamera = async (mode = 'food') => {
    setScanMode(mode);
    setIsCameraOpen(true);
    try {
      await startStream(mode);
    } catch (err) {
      alert("카메라 권한을 확인해주세요.");
      setIsCameraOpen(false);
    }
  };

  // 카메라 안에서 모드 전환
  const switchMode = async (newMode) => {
    if (newMode === scanMode) return;
    setScanMode(newMode);
    try {
      await startStream(newMode);
    } catch (err) {
      console.error("모드 전환 오류:", err);
    }
  };

  const closeCamera = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    setIsCameraOpen(false);
  };

  const handleRetake = () => {
    openCamera(scanMode);
  };

  const handleCapture = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      canvasRef.current.width  = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      context.drawImage(videoRef.current, 0, 0);
      const quality = scanMode === 'receipt' ? 1.0 : 0.85;
      setCapturedImg(canvasRef.current.toDataURL('image/jpeg', quality));
      closeCamera();
      setView('scan_result');
    }
  };

  if (loading) return <div className="h-screen flex items-center justify-center">로딩 중...</div>;

  if (!user) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center bg-gray-50 px-6">
        <div className="mb-8 w-20 h-20 bg-black rounded-3xl flex items-center justify-center shadow-xl">
          <ShoppingBasket size={40} className="text-white" />
        </div>
        <h1 className="text-2xl font-black mb-10">SmartPantry</h1>
        <div className="w-full flex flex-col items-center gap-3">
          <a href="/auth/kakao" className="w-full max-w-[280px] bg-[#FEE500] text-[#3c1e1e] py-4 rounded-2xl font-bold text-center">카카오 로그인</a>
          <a href="/auth/google" className="w-full max-w-[280px] bg-white text-gray-700 py-4 rounded-2xl font-bold text-center border shadow-sm">Google 로그인</a>
        </div>
      </div>
    );
  }

  if (user.isAgreed === 0) {
    return (
      <div className="bg-gray-100 min-h-dvh flex justify-center">
        <div className="w-full max-w-[430px] h-dvh bg-white shadow-2xl">
          <TermsPage onAgree={handleAgree} />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-100 min-h-dvh flex justify-center">
      <div className="w-full max-w-[430px] h-dvh bg-white flex flex-col relative overflow-hidden shadow-2xl overscroll-none">
        {isCameraOpen ? (
          <div className="flex-1 bg-black flex flex-col relative">

            {/* 뒤로가기 버튼 */}
            <button
              onClick={closeCamera}
              className="absolute top-12 left-6 z-10 text-white p-2 bg-white/10 rounded-full"
            >
              <ChevronLeft />
            </button>

            {/* 모드 전환 버튼 (식재료 / 영수증) */}
            <div className="absolute top-12 left-1/2 -translate-x-1/2 z-10 flex gap-2 bg-black/30 p-1 rounded-full backdrop-blur-sm">
              <button
                onClick={() => switchMode('food')}
                className={`px-5 py-2 rounded-full text-sm font-bold transition-all whitespace-nowrap ${
                  scanMode === 'food'
                    ? 'bg-white text-gray-900 shadow-md'
                    : 'text-white/70 hover:text-white'
                }`}
              >
                🥦 식재료
              </button>
              <button
                onClick={() => switchMode('receipt')}
                className={`px-5 py-2 rounded-full text-sm font-bold transition-all whitespace-nowrap ${
                  scanMode === 'receipt'
                    ? 'bg-white text-gray-900 shadow-md'
                    : 'text-white/70 hover:text-white'
                }`}
              >
                🧾 영수증
              </button>
            </div>

            {/* 안내 문구 */}
            <div className={`absolute top-24 left-1/2 -translate-x-1/2 z-10 mt-2 px-4 py-1.5 rounded-full text-white text-xs font-bold whitespace-nowrap
              ${scanMode === 'receipt' ? 'bg-blue-600/80' : 'bg-gray-900/80'}`}>
              {scanMode === 'receipt' ? '영수증을 펼쳐서 촬영해주세요' : '식재료를 카메라에 맞춰주세요'}
            </div>

            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-contain" />

            {/* 촬영 버튼 */}
            <button
              onClick={handleCapture}
              className="absolute bottom-12 left-1/2 -translate-x-1/2 w-20 h-20 rounded-full border-4 border-white bg-white/20 active:scale-95 transition-all"
            />

            <canvas ref={canvasRef} className="hidden" />
          </div>
        ) : (
          <>
            <header className="h-16 flex justify-between items-center px-6 border-b">
              <button onClick={() => setView('home')}><ChevronLeft size={24} /></button>
              <h1 className="text-lg font-black">SmartPantry</h1>
              <div className="w-9" />
            </header>
            <main className="flex-1 overflow-y-auto overscroll-none">
              {view === 'home'        && <HomePage onScanClick={openCamera} userName={user.name} pantryItems={pantryItems} onNavigate={setView} />}
              {view === 'pantry'      && <MainPage />}
              {view === 'recipe'      && <RecipePage />}
              {view === 'mypage'      && <MyPage userName={user.name} consents={user.consents} onLogout={() => window.location.href = "/logout"} onUserNameChange={(name) => setUser(prev => ({ ...prev, name }))} />}
              {view === 'scan_result' && <ScanResultPage capturedImg={capturedImg} onBack={handleRetake} onNavigate={setView} scanMode={scanMode} />}
            </main>
            <nav className="shrink-0 h-20 bg-white border-t flex justify-around items-center px-6">
              <button onClick={() => setView('home')}   className={view === 'home'   ? 'text-black' : 'text-gray-300'}><Home /></button>
              <button onClick={() => setView('pantry')} className={view === 'pantry' ? 'text-black' : 'text-gray-300'}><ShoppingBasket /></button>
              <button onClick={() => openCamera(scanMode)} className="w-14 h-14 bg-black text-white rounded-2xl -mt-10 border-4 border-white flex items-center justify-center"><Camera /></button>
              <button onClick={() => setView('recipe')} className={view === 'recipe' ? 'text-black' : 'text-gray-300'}><Sparkles /></button>
              <button onClick={() => setView('mypage')} className={view === 'mypage' ? 'text-black' : 'text-gray-300'}><User /></button>
            </nav>

            <InstallPwaBanner />
          </>
        )}

        {!expiredDismissed && expiredItems.length > 0 && (
          <ExpiredItemsModal
            items={expiredItems}
            onDiscard={handleDiscardExpired}
            onDismiss={() => setExpiredDismissed(true)}
          />
        )}
      </div>
    </div>
  );
}

export default App;