import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './lib/supabase';
import { User, ChatItem, Message, FriendRequest, Friend, Group } from './types';
import { 
  Search, 
  MessageCircle, 
  UserPlus, 
  Settings, 
  LogOut, 
  Phone, 
  Video, 
  MoreVertical, 
  Paperclip, 
  Smile, 
  Send, 
  Camera, 
  X, 
  ArrowLeft,
  Check,
  User as UserIcon,
  Users,
  QrCode
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Peer from 'peerjs';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';

// --- Constants ---
const STAMPS = [
  "https://api.iconify.design/noto:grinning-face.svg",
  "https://api.iconify.design/noto:smiling-face-with-heart-eyes.svg",
  "https://api.iconify.design/noto:thumbs-up.svg",
  "https://api.iconify.design/noto:partying-face.svg",
  "https://api.iconify.design/noto:fire.svg",
  "https://api.iconify.design/noto:rocket.svg",
  "https://api.iconify.design/noto:laughing-with-tears.svg"
];

const SHA256 = async (msg: string) => {
  const buf = new TextEncoder().encode(msg);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
};

export default function App() {
  // --- Auth State ---
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const authFormRef = useRef<HTMLFormElement>(null);

  // --- UI State ---
  const [activeTab, setActiveTab] = useState<'all' | 'friends' | 'groups'>('all');
  const [activeChat, setActiveChat] = useState<ChatItem | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTab, setAddTab] = useState<'friend' | 'group' | 'qr' | 'requests'>('friend');
  const [showStampPicker, setShowStampPicker] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 800);

  // --- Data State ---
  const [friends, setFriends] = useState<Friend[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>([]);
  const [qrScanner, setQrScanner] = useState<Html5Qrcode | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // --- Effects ---
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 800);
    window.addEventListener('resize', handleResize);
    
    // Check Session
    const saved = localStorage.getItem('line_premium_session');
    if (saved) {
      setUser(JSON.parse(saved));
    }

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem('line_premium_session', JSON.stringify(user));
      loadData();
      setupRealtime();
    }
  }, [user]);

  useEffect(() => {
    if (activeChat) {
      loadMessages();
    }
  }, [activeChat]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // --- Data Fetching ---
  const loadData = async () => {
    if (!user) return;
    await Promise.all([loadFriends(), loadGroups(), loadPendingRequests()]);
  };

  const loadFriends = async () => {
    if (!user) return;
    const { data: userNow } = await supabase.from('line_accounts').select('friends').eq('id', user.id).single();
    if (userNow) {
      const friendNames = (userNow.friends || '').split(',').filter(Boolean);
      if (friendNames.length > 0) {
        const { data } = await supabase.from('line_accounts').select('id, username, avatar_url, peer_id').in('username', friendNames);
        setFriends((data || []).map(f => ({ ...f, chatType: 'user' })));
      } else {
        setFriends([]);
      }
    }
  };

  const loadGroups = async () => {
    if (!user) return;
    const groupIds = (user.groups || "").split(',').filter(Boolean);
    if (groupIds.length > 0) {
      const { data } = await supabase.from('line_groups').select('*').in('id', groupIds);
      setGroups((data || []).map(g => ({ ...g, chatType: 'group', username: g.name })));
    } else {
      setGroups([]);
    }
  };

  const loadPendingRequests = async () => {
    if (!user) return;
    // 400エラー回避のため、結合クエリを使わずにリクエストのみを取得
    const { data: requests, error } = await supabase
      .from('line_friend_requests')
      .select('*, sender:line_accounts!line_friend_requests_sender_id_fkey(username, avatar_url)')
      .eq('receiver_id', user.id)
      .eq('status', 'pending');
    
    if (error) {
      console.error("Fetch requests error:", error);
      return;
    }

    if (!requests) {
      setPendingRequests([]);
      return;
    }

    // group_idがある場合のみ、追加でグループ情報を取得
    const groupInvites = requests.filter(r => r.group_id);
    if (groupInvites.length > 0) {
      const groupIds = groupInvites.map(r => r.group_id);
      const { data: groupsData } = await supabase
        .from('line_groups')
        .select('id, name')
        .in('id', groupIds);
      
      const mapped = requests.map(req => ({
        ...req,
        group: groupsData?.find(g => g.id === req.group_id) || null
      }));
      setPendingRequests(mapped);
    } else {
      setPendingRequests(requests);
    }
  };

  const loadMessages = async () => {
    if (!activeChat || !user) return;
    let query = supabase.from('line_messages').select('*');
    
    if (activeChat.chatType === 'user') {
      // 1-to-1 chat: (Me to Friend) OR (Friend to Me)
      query = query.or(`and(sender_id.eq.${user.id},receiver_id.eq.${activeChat.id}),and(sender_id.eq.${activeChat.id},receiver_id.eq.${user.id})`);
    } else {
      query = query.eq('receiver_id', activeChat.id);
    }

    const { data } = await query.order('created_at', { ascending: true });
    setMessages(data || []);
  };

  const setupRealtime = () => {
    if (!user) return;
    const channel = supabase.channel('realtime-updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'line_messages' }, payload => {
        if (!activeChat) return;
        const msg = payload.new as Message;
        const isRelevant = activeChat.chatType === 'user' 
          ? (msg.sender_id === user.id && msg.receiver_id === activeChat.id) || (msg.sender_id === activeChat.id && msg.receiver_id === user.id)
          : (msg.receiver_id === activeChat.id);
        
        if (isRelevant) {
          setMessages(prev => {
            if (prev.find(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'line_friend_requests' }, () => {
         loadPendingRequests();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  // --- Actions ---
  const logout = () => {
    console.log("Logout triggered");
    localStorage.removeItem('line_premium_session');
    setUser(null);
    setActiveChat(null);
    setShowAddModal(false);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthLoading(true);
    console.log("Authentication started...");
    
    const formData = new FormData(authFormRef.current!);
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;
    const avatarFile = (authFormRef.current?.querySelector('input[type="file"]') as HTMLInputElement)?.files?.[0];

    try {
      if (!username || !password) throw new Error("ユーザー名とパスワードを入力してください");
      const passHash = await SHA256(password);
      console.log(`Loging in as: ${username}`);

      if (authMode === 'login') {
        const { data, error } = await supabase
          .from('line_accounts')
          .select('*')
          .eq('username', username)
          .eq('password', passHash)
          .maybeSingle();

        if (error) {
          console.error("Supabase error during login:", error);
          throw error;
        }
        if (!data) throw new Error("ユーザー名またはパスワードが正しくありません");
        console.log("Login success");
        setUser(data);
      } else {
        // ... (Registration logic)
        let avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=06C755&color=fff`;
        if (avatarFile) {
          const fileName = `${Date.now()}_${avatarFile.name}`;
          const { error: storageError } = await supabase.storage.from('line-media').upload(`avatars/${fileName}`, avatarFile);
          if (!storageError) {
             const { data: publicUrl } = supabase.storage.from('line-media').getPublicUrl(`avatars/${fileName}`);
             avatarUrl = publicUrl.publicUrl;
          }
        }

        const peerId = 'peer-' + Math.random().toString(36).substring(2, 11);
        const { data, error } = await supabase
          .from('line_accounts')
          .insert([{ 
            username, 
            password: passHash, 
            avatar_url: avatarUrl, 
            peer_id: peerId,
            friends: '',
            groups: ''
          }])
          .select().single();

        if (error) {
          console.error("Supabase error during registration:", error);
          throw (error.code === '23505' ? new Error("このユーザー名は既に使用されています") : error);
        }
        console.log("Registration success");
        setUser(data);
      }
    } catch (err: any) {
      console.error("Auth Exception:", err);
      alert(err.message || "認証に失敗しました。");
    } finally {
      setIsAuthLoading(false);
    }
  };

  const sendMessage = async (type: Message['type'] = 'text', content?: string) => {
    if (!activeChat || !user) return;
    const text = content || (document.getElementById('msg-input') as HTMLTextAreaElement)?.value.trim();
    if (!text && type === 'text') return;

    const { error } = await supabase.from('line_messages').insert([{
      sender_id: user.id,
      receiver_id: activeChat.id,
      type,
      text: (type === 'text' || type === 'sticker') ? text : null,
      file_url: (type !== 'text' && type !== 'sticker') ? text : null
    }]);

    if (!error && type === 'text') {
      (document.getElementById('msg-input') as HTMLTextAreaElement).value = '';
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const type = file.type.startsWith('image/') ? 'image' : (file.type.startsWith('video/') ? 'video' : 'file');
    const fileName = `${Date.now()}_${file.name}`;

    try {
      const { error } = await supabase.storage.from('line-media').upload(`chats/${fileName}`, file);
      if (error) throw error;
      const { data: publicUrl } = supabase.storage.from('line-media').getPublicUrl(`chats/${fileName}`);
      sendMessage(type, publicUrl.publicUrl);
    } catch (err: any) {
      alert("失敗しました: " + err.message);
    }
  };

  // --- Friend Request Logic (Reciprocal) ---
  const sendFriendRequest = async (targetUsername: string) => {
    if (!user) return;
    if (targetUsername === user.username) return alert("自分には送れません");

    const { data: target } = await supabase.from('line_accounts').select('id').eq('username', targetUsername).maybeSingle();
    if (!target) return alert("ユーザーが見つかりません");

    const { error } = await supabase.from('line_friend_requests').insert([{ sender_id: user.id, receiver_id: target.id }]);
    if (error) alert("既に申請済みか、エラーが発生しました");
    else alert("申請を送りました");
  };

  const handleApproveRequest = async (req: any) => {
    if (!user) return;
    try {
      if (req.group_id) {
        // --- Group Invitation Approval ---
        const myGroups = (user.groups || "").split(',').filter(Boolean);
        if (!myGroups.includes(req.group_id)) {
          myGroups.push(req.group_id);
          await supabase.from('line_accounts').update({ groups: myGroups.join(',') }).eq('id', user.id);
          setUser(prev => prev ? { ...prev, groups: myGroups.join(',') } : null);
        }
        await supabase.from('line_friend_requests').delete().eq('id', req.id);
        alert(`グループ「${req.group?.name}」に参加しました！`);
      } else {
        // --- Friend Request Approval ---
        const senderId = req.sender_id;
        const senderName = req.sender.username;
        const receiverId = user.id;
        const receiverName = user.username;

        let myFriends = (user.friends || "").split(',').filter(Boolean);
        if (!myFriends.includes(senderName)) {
          myFriends.push(senderName);
          await supabase.from('line_accounts').update({ friends: myFriends.join(',') }).eq('id', receiverId);
          setUser(prev => prev ? { ...prev, friends: myFriends.join(',') } : null);
        }

        const { data: senderData } = await supabase.from('line_accounts').select('friends').eq('id', senderId).single();
        let senderFriendsList = (senderData?.friends || "").split(',').filter(Boolean);
        if (!senderFriendsList.includes(receiverName)) {
          senderFriendsList.push(receiverName);
          await supabase.from('line_accounts').update({ friends: senderFriendsList.join(',') }).eq('id', senderId);
        }
        await supabase.from('line_friend_requests').delete().eq('id', req.id);
        alert(`${senderName}さんと友だちになりました！`);
      }
      loadData();
    } catch (err) {
      console.error(err);
      alert("承認中にエラーが発生しました");
    }
  };

  const handleCreateGroup = async () => {
    if (!user) return;
    const name = (document.getElementById('new-group-name') as HTMLInputElement).value.trim();
    const membersInput = (document.getElementById('new-group-members') as HTMLInputElement).value.trim();
    if (!name) return alert("グループ名を入力してください");

    const memberNames = membersInput.split(',').map(m => m.trim()).filter(Boolean);

    try {
      // 1. Create the group first (Owner only added immediately)
      const { data: newGroup, error: groupErr } = await supabase
        .from('line_groups')
        .insert([{ name, owner_id: user.id }])
        .select().single();
      
      if (groupErr) throw groupErr;

      // 2. Add owner to their own groups list
      const myGroups = (user.groups || "").split(',').filter(Boolean);
      if (!myGroups.includes(newGroup.id)) {
        myGroups.push(newGroup.id);
        await supabase.from('line_accounts').update({ groups: myGroups.join(',') }).eq('id', user.id);
        setUser(prev => prev ? { ...prev, groups: myGroups.join(',') } : null);
      }

      // 3. Send invitations to other members
      if (memberNames.length > 0) {
        const { data: targetAccounts } = await supabase.from('line_accounts').select('id').in('username', memberNames);
        if (targetAccounts && targetAccounts.length > 0) {
          const invitations = targetAccounts
            .filter(acc => acc.id !== user.id)
            .map(acc => ({
              sender_id: user.id,
              receiver_id: acc.id,
              group_id: newGroup.id, // Group ID stored in requests table
              status: 'pending'
            }));
          
          if (invitations.length > 0) {
            // Using line_friend_requests table with group_id to distinguish
            await supabase.from('line_friend_requests').insert(invitations);
          }
        }
      }

      alert("グループを作成し、招待を送りました。承認されると参加されます。");
      setShowAddModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      alert("グループ作成に失敗しました: " + err.message);
    }
  };

  const handleRejectRequest = async (id: string) => {
    await supabase.from('line_friend_requests').delete().eq('id', id);
    loadPendingRequests();
  };

  const startScanner = async () => {
    setIsScanning(true);
    // 小さいディレイを入れてReactが#readerをレンダリングするのを待つ
    setTimeout(async () => {
      try {
        const scanner = new Html5Qrcode("reader");
        setQrScanner(scanner);
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 250 },
          async (text) => {
            await scanner.stop();
            setQrScanner(null);
            setIsScanning(false);
            sendFriendRequest(text);
          },
          () => {}
        );
      } catch (err) {
        console.error("Scanner error:", err);
        setIsScanning(false);
      }
    }, 100);
  };

  const stopScanner = () => {
    if (qrScanner) {
      qrScanner.stop().then(() => {
        setQrScanner(null);
        setIsScanning(false);
      });
    } else {
      setIsScanning(false);
    }
  };

  // --- Helpers ---
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const filteredItems = [...friends, ...groups].filter(item => {
    if (activeTab === 'friends' && item.chatType !== 'user') return false;
    if (activeTab === 'groups' && item.chatType !== 'group') return false;
    if (searchQuery && !item.username?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  // --- Rendering ---
  if (!user) {
    return (
      <div id="auth-screen" className="relative h-screen w-screen flex items-center justify-center p-4">
        <div id="bg-blobs">
          <div className="blob blob-1"></div>
          <div className="blob blob-2"></div>
          <div className="blob blob-3"></div>
        </div>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel w-full max-w-[400px] p-8 rounded-2xl shadow-2xl relative z-10"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-line-primary rounded-2xl flex items-center justify-center text-white mb-4 shadow-lg">
              <MessageCircle size={32} />
            </div>
            <h1 className="text-2xl font-bold text-gray-800">LINE Premium</h1>
            <p className="text-gray-500 text-sm">繋がる。もっと、楽しく。</p>
          </div>

          <div className="flex mb-6 bg-gray-100 p-1 rounded-xl">
            <button 
              onClick={() => setAuthMode('login')}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${authMode === 'login' ? 'bg-white text-line-primary shadow-sm' : 'text-gray-500'}`}
            >
              ログイン
            </button>
            <button 
              onClick={() => setAuthMode('register')}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${authMode === 'register' ? 'bg-white text-line-primary shadow-sm' : 'text-gray-500'}`}
            >
              新規登録
            </button>
          </div>

          <form ref={authFormRef} onSubmit={handleAuth} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-500 ml-1">ユーザー名</label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input 
                  name="username" 
                  type="text" 
                  placeholder="ユーザー名を入力" 
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-line-primary/20 focus:border-line-primary transition-all"
                  required 
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-500 ml-1">パスワード</label>
              <div className="relative">
                <Settings className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input 
                  name="password" 
                  type="password" 
                  placeholder="パスワードを入力" 
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-line-primary/20 focus:border-line-primary transition-all"
                  required 
                />
              </div>
            </div>
            {authMode === 'register' && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 ml-1">プロフィール画像</label>
                <div className="relative">
                  <Camera className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input 
                    type="file" 
                    accept="image/*"
                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-xl file:hidden text-sm text-gray-500"
                  />
                </div>
              </div>
            )}
            <button 
              type="submit" 
              disabled={isAuthLoading}
              className="w-full py-4 bg-line-primary text-white font-bold rounded-xl shadow-lg shadow-line-primary/30 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {isAuthLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                <>
                  {authMode === 'login' ? 'ログイン' : 'アカウント作成'}
                </>
              )}
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-white text-[#111111]">
      <header className="h-[60px] bg-white border-b border-border-custom px-6 flex items-center justify-between shrink-0">
        <div className="text-line-primary font-extrabold text-2xl tracking-tighter">LINE</div>
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
          <input 
            type="text" 
            placeholder="名前、トークを検索" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-[300px] bg-[#eeeeee] rounded-full py-1.5 pl-10 pr-4 text-xs focus:outline-none"
          />
        </div>
        <button 
          onClick={() => { setShowAddModal(true); setAddTab('qr'); }}
          className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 border border-gray-100 hover:brightness-90 transition-all"
        >
           <img src={user.avatar_url} className="w-full h-full object-cover" alt="Profile" />
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* --- Sidebar Nav --- */}
        <nav className="sidebar-pane h-full shrink-0">
          <button 
            onClick={() => setActiveTab('all')}
            className={`w-[44px] h-[44px] rounded-xl flex items-center justify-center transition-all ${activeTab === 'all' ? 'bg-line-primary text-white shadow-lg' : 'bg-[#444444] text-white hover:bg-[#555555]'}`}
          >
            <MessageCircle size={20} />
          </button>
          <button 
            onClick={() => { setShowAddModal(true); setAddTab('requests'); }}
            className={`relative w-[44px] h-[44px] rounded-xl flex items-center justify-center transition-all bg-[#444444] text-white hover:bg-[#555555]`}
          >
            <UserPlus size={20} />
            {pendingRequests.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] flex items-center justify-center rounded-full font-bold border-2 border-[#2c2c2c]">
                {pendingRequests.length}
              </span>
            )}
          </button>
          <button 
            onClick={() => { setShowAddModal(true); setAddTab('qr'); }}
            className={`w-[44px] h-[44px] rounded-xl flex items-center justify-center transition-all bg-[#444444] text-white hover:bg-[#555555]`}
          >
            <QrCode size={20} />
          </button>
          <div className="flex-1" />
          <button 
            onClick={() => { setShowAddModal(true); setAddTab('friend'); }}
            className="text-gray-500 hover:text-white mb-6"
          >
            <Settings size={20} />
          </button>
        </nav>

        {/* --- List Pane --- */}
        <aside className={`list-pane h-full transition-all ${isMobile && activeChat ? 'hidden' : 'flex'}`}>
          <div className="p-5 border-b border-border-custom">
             <h2 className="text-lg font-bold">ホーム</h2>
             <p className="text-[13px] text-gray-500">友達 {friends.length}</p>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {pendingRequests.length > 0 && (
              <>
                <div className="section-title">友達リクエスト <span className="ml-2 bg-red-500 text-white px-2 py-0.5 rounded-full text-[10px]">{pendingRequests.length}</span></div>
                {pendingRequests.map(req => (
                  <div key={req.id} className="flex items-center p-3 px-5 gap-3 border-b border-gray-50 bg-[#fffdfa]">
                    <img src={req.sender.avatar_url} className="w-12 h-12 avatar-square object-cover" alt="" />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[15px] truncate">{req.sender.username}</p>
                      <p className="text-[12px] text-gray-500">リクエストが届いています</p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => handleApproveRequest(req)} className="line-btn-approve px-3 py-1.5 text-[11px]">承認</button>
                      <button onClick={() => handleRejectRequest(req.id)} className="line-btn-ignore px-3 py-1.5 text-[11px]">拒否</button>
                    </div>
                  </div>
                ))}
              </>
            )}

            <div className="section-title">{activeTab === 'all' ? 'トーク一覧' : activeTab === 'friends' ? '友達' : 'グループ'}</div>
            {filteredItems.length === 0 ? (
              <div className="p-10 text-center text-gray-400">
                <p className="text-sm">データがありません</p>
              </div>
            ) : (
              filteredItems.map(item => (
                <button 
                  key={item.id}
                  onClick={() => setActiveChat(item)}
                  className={`w-full flex items-center gap-3 p-4 px-5 hover:bg-gray-50 transition-all border-b border-[#f9f9f9] ${activeChat?.id === item.id ? 'bg-[#f0f3f9]' : 'bg-white'}`}
                >
                  <img src={item.avatar_url || `https://ui-avatars.com/api/?name=${item.username}`} className="w-12 h-12 avatar-square object-cover shrink-0" alt="" />
                  <div className="flex-1 text-left min-w-0">
                    <div className="flex justify-between items-baseline mb-0.5">
                      <span className="font-bold text-[15px] text-[#111111] truncate">{item.username}</span>
                      <span className="text-[10px] text-gray-400">Now</span>
                    </div>
                    <p className="text-[12px] text-gray-500 truncate">
                      {item.chatType === 'group' ? 'グループチャット' : 'メッセージを見る'}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* --- Detail/Chat Area --- */}
        <main className={`flex-1 flex flex-col bg-[#f8f9fb] ${isMobile && !activeChat ? 'hidden' : 'flex'}`}>
          {activeChat ? (
            <>
              <header className="h-[60px] bg-white border-b border-border-custom flex items-center justify-between px-6 shrink-0">
                <div className="flex items-center gap-3">
                  {isMobile && (
                    <button onClick={() => setActiveChat(null)} className="p-2 -ml-2 text-gray-500"><ArrowLeft size={18} /></button>
                  )}
                  <img src={activeChat.avatar_url} className="w-10 h-10 avatar-square object-cover" alt="" />
                  <h3 className="font-bold text-[16px]">{activeChat.username}</h3>
                </div>
                <div className="flex items-center gap-1">
                  <button className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><Phone size={18} /></button>
                  <button className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><Video size={18} /></button>
                  <button className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><MoreVertical size={18} /></button>
                </div>
              </header>

              <div className="flex-1 overflow-y-auto p-6 flex flex-col custom-scrollbar">
                <div className="flex-1" />
                {messages.map((msg, i) => {
                  const isMine = msg.sender_id === user.id;
                  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  return (
                    <div key={msg.id} className={`message-wrapper ${isMine ? 'sent' : ''}`}>
                      {!isMine && (
                         <img src={activeChat.avatar_url} className="w-9 h-9 avatar-square object-cover self-start" alt="" />
                      )}
                      <div className="flex flex-col">
                        <div className="flex items-end gap-1.5">
                          {isMine && <span className="meta">{time}</span>}
                          <div className="message">
                            {msg.type === 'text' && msg.text}
                            {msg.type === 'sticker' && <img src={msg.text} className="w-24 h-24" alt="Sticker" />}
                            {msg.type === 'image' && <img src={msg.file_url} className="max-w-[240px] rounded-xl shadow-sm" />}
                            {msg.type === 'video' && <video src={msg.file_url} controls className="max-w-[240px] rounded-xl shadow-sm" />}
                            {msg.type === 'file' && <a href={msg.file_url} className="text-line-primary font-bold">📄 ファイル</a>}
                          </div>
                          {!isMine && <span className="meta">{time}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-4 bg-white border-t border-border-custom">
                <textarea 
                  id="msg-input" 
                  placeholder="メッセージを入力" 
                  className="w-full p-3 bg-[#f5f5f5] rounded-xl text-sm border-none focus:ring-0 resize-none h-20 mb-3"
                  onKeyDown={(e) => { if(e.key==='Enter' && !e.shiftKey){e.preventDefault(); sendMessage();}} }
                />
                <div className="flex justify-between items-center">
                  <div className="flex gap-4">
                    <button onClick={() => (document.getElementById('f-up') as any).click()} className="text-gray-400 hover:text-line-primary transition-all"><Paperclip size={20} /></button>
                    <input id="f-up" type="file" className="hidden" onChange={handleFileUpload} />
                    <button onClick={() => setShowStampPicker(!showStampPicker)} className="text-gray-400 hover:text-line-primary"><Smile size={20} /></button>
                  </div>
                  <button onClick={() => sendMessage()} className="bg-line-primary text-white font-bold px-8 py-2 rounded-lg hover:brightness-95 transition-all text-sm">
                    送信
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
              <div className="text-[80px] text-[#e0e0e0] mb-6">👤</div>
              <h2 className="text-xl font-bold text-gray-500 mb-2">友達リクエストを承認すると<br />双方のリストに追加されます</h2>
              <p className="text-sm text-gray-400">左側のリストから「承認」ボタンを押して<br />新しい繋がりを始めましょう</p>
            </div>
          )}
        </main>
      </div>

      {/* --- Add Modal --- */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setShowAddModal(false); stopScanner(); }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="glass-panel w-full max-w-[440px] rounded-3xl shadow-2xl overflow-hidden relative z-10"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white/50">
                <h3 className="text-lg font-bold text-gray-800">友だち追加 / 設定</h3>
                <button onClick={() => { setShowAddModal(false); stopScanner(); }} className="text-gray-400 hover:text-gray-600 transition-all p-1">
                  <X size={24} />
                </button>
              </div>

              <div className="flex p-2 bg-gray-100 rounded-xl mx-6 mt-6">
                <button onClick={() => { setAddTab('friend'); stopScanner(); }} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${addTab === 'friend' ? 'bg-white text-line-primary shadow-sm' : 'text-gray-500'}`}>
                  検索
                </button>
                <button onClick={() => { setAddTab('qr'); stopScanner(); }} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${addTab === 'qr' ? 'bg-white text-line-primary shadow-sm' : 'text-gray-500'}`}>
                  QR
                </button>
                <button onClick={() => { setAddTab('requests'); stopScanner(); }} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${addTab === 'requests' ? 'bg-white text-line-primary shadow-sm' : 'text-gray-500'} relative`}>
                  申請
                  {pendingRequests.length > 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-ping"></span>}
                </button>
                <button onClick={() => { setAddTab('group'); stopScanner(); }} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${addTab === 'group' ? 'bg-white text-line-primary shadow-sm' : 'text-gray-500'}`}>
                   グループ
                </button>
              </div>

              <div className="p-8 min-h-[300px] flex flex-col">
                <div className="flex-1">
                  {addTab === 'friend' && (
                    <div className="space-y-6">
                      <div className="space-y-2">
                         <p className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">ユーザー検索</p>
                         <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input 
                              id="search-id"
                              placeholder="ユーザーIDを入力" 
                              className="w-full pl-10 pr-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-line-primary/20 transition-all"
                            />
                         </div>
                      </div>
                      <button 
                        onClick={() => sendFriendRequest((document.getElementById('search-id') as HTMLInputElement).value)}
                        className="w-full py-4 bg-line-primary text-white font-bold rounded-2xl shadow-lg shadow-line-primary/30 active:scale-95 transition-all"
                      >
                        検索・追加
                      </button>
                    </div>
                  )}

                  {addTab === 'qr' && (
                    <div className="flex flex-col items-center gap-6">
                      <div className="flex bg-gray-100 p-1 rounded-lg">
                        <button id="qr-mine-btn" onClick={() => stopScanner()} className="px-4 py-1 text-xs font-bold rounded-md bg-white text-line-primary shadow-sm">マイQR</button>
                        <button id="qr-scan-btn" onClick={() => startScanner()} className="px-4 py-1 text-xs font-bold rounded-md text-gray-500">スキャン</button>
                      </div>
                      
                      {!isScanning ? (
                        <div className="flex flex-col items-center p-6 bg-white rounded-3xl border border-gray-100 shadow-xl">
                          <QRCodeSVG value={user.username} size={200} />
                          <div className="mt-6 text-center">
                            <p className="font-bold text-gray-800">{user.username}</p>
                            <p className="text-xs text-gray-400 mt-1">スキャンして追加</p>
                          </div>
                        </div>
                      ) : (
                        <div id="reader" className="w-full max-w-[300px] aspect-square rounded-3xl overflow-hidden border-4 border-line-primary/20"></div>
                      )}
                    </div>
                  )}

                  {addTab === 'requests' && (
                    <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                      {pendingRequests.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-gray-300 gap-2">
                          <UserPlus size={48} opacity={0.3} />
                          <p className="text-sm">届いている申請はありません</p>
                        </div>
                      ) : (
                        pendingRequests.map(req => (
                          <div key={req.id} className="flex items-center gap-4 p-4 bg-white/50 border border-white rounded-2xl shadow-sm">
                             <img src={req.sender.avatar_url} className="w-12 h-12 rounded-2xl object-cover" alt="" />
                             <div className="flex-1 overflow-hidden">
                                <p className="font-bold text-gray-800 truncate">{req.sender.username}</p>
                                <p className="text-[10px] text-gray-400">
                                  {req.group_id ? `グループ「${req.group?.name}」への招待` : '友だちリクエスト'}
                                </p>
                             </div>
                             <div className="flex gap-2">
                                <button 
                                  onClick={() => handleApproveRequest(req)}
                                  className="w-9 h-9 flex items-center justify-center bg-line-primary text-white rounded-xl shadow-lg shadow-line-primary/20 hover:scale-105 active:scale-95 transition-all"
                                >
                                  <Check size={18} />
                                </button>
                                <button 
                                  onClick={() => handleRejectRequest(req.id)}
                                  className="w-9 h-9 flex items-center justify-center bg-gray-100 text-gray-400 rounded-xl hover:bg-red-50 hover:text-red-500 active:scale-95 transition-all"
                                >
                                  <X size={18} />
                                </button>
                             </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {addTab === 'group' && (
                     <div className="space-y-4">
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">グループ名</label>
                          <input id="new-group-name" placeholder="グループ名を入力" className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-line-primary/20 transition-all" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">招待メンバー (ユーザー名, カンマ区切り)</label>
                          <input id="new-group-members" placeholder="user1, user2" className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-line-primary/20 transition-all" />
                        </div>
                        <button 
                          onClick={handleCreateGroup}
                          className="w-full py-4 bg-gray-800 text-white font-bold rounded-2xl shadow-lg active:scale-95 transition-all mt-4"
                        >
                          グループ作成
                        </button>
                     </div>
                  )}
                </div>

                <div className="mt-8 pt-8 border-t border-gray-100">
                  <button 
                    onClick={logout}
                    className="w-full py-4 border-2 border-red-50 text-red-500 font-bold rounded-2xl hover:bg-red-50 transition-all flex items-center justify-center gap-2"
                  >
                    <LogOut size={18} />
                    <span>ログアウト</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
