import React, { useState, useEffect, createContext, useContext } from 'react';
import { Github, LogOut, Settings, Users, Code2, Terminal as TerminalIcon, Bot, Play, Save, Search, Tag } from 'lucide-react';
import { Editor } from '@monaco-editor/react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

// --- Types ---
type User = { id: string; email: string; nickname: string; avatar_url: string };
type Template = { id: number; title: string; description: string; code: string; tags: string };

// --- Contexts ---
const AuthContext = createContext<{ user: User | null; logout: () => void; refreshUser: () => void }>({ user: null, logout: () => {}, refreshUser: () => {} });

// --- Main App Component ---
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'editor' | 'admin' | 'settings'>('editor');

  const fetchUser = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        setUser(await res.json());
      } else {
        setUser(null);
      }
    } catch (e) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
    
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) return;
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        fetchUser();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleLogin = async () => {
    try {
      const res = await fetch('/api/auth/github/url');
      const { url } = await res.json();
      window.open(url, 'oauth_popup', 'width=600,height=700');
    } catch (e) {
      console.error('Login failed', e);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-400">Loading...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 font-sans">
        <div className="max-w-md w-full p-8 bg-zinc-900 rounded-2xl border border-zinc-800 shadow-2xl text-center">
          <div className="w-16 h-16 bg-blue-500/10 text-blue-400 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Code2 size={32} />
          </div>
          <h1 className="text-2xl font-semibold mb-2">Python Co-Lab</h1>
          <p className="text-zinc-400 mb-8">A multi-user coding lab for Python CLI tools. Please sign in to continue.</p>
          
          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 bg-white text-black py-3 px-4 rounded-xl font-medium hover:bg-zinc-200 transition-colors"
          >
            <Github size={20} />
            Sign in with GitHub
          </button>
          
          <div className="mt-8 text-sm text-zinc-500">
            <p>Only admitted users can access the lab.</p>
            <p>Contact the administrator to request access.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, logout: handleLogout, refreshUser: fetchUser }}>
      <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
        {/* Top Navigation */}
        <header className="h-14 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0 bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-500/20 text-blue-400 rounded-lg flex items-center justify-center">
              <Code2 size={18} />
            </div>
            <span className="font-medium tracking-tight">Python Co-Lab</span>
          </div>
          
          <div className="flex items-center gap-4">
            <nav className="flex items-center gap-1 mr-4">
              <button 
                onClick={() => setActiveTab('editor')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'editor' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'}`}
              >
                Workspace
              </button>
              <button 
                onClick={() => setActiveTab('admin')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'admin' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'}`}
              >
                <Users size={14} className="inline mr-1.5" />
                Access
              </button>
            </nav>
            
            <div className="flex items-center gap-3 pl-4 border-l border-zinc-800">
              <button 
                onClick={() => setActiveTab('settings')}
                className="flex items-center gap-2 text-sm text-zinc-300 hover:text-white transition-colors"
              >
                <img src={user.avatar_url} alt={user.nickname} className="w-6 h-6 rounded-full" />
                <span>{user.nickname}</span>
              </button>
              <button onClick={handleLogout} className="text-zinc-500 hover:text-red-400 transition-colors p-1" title="Log out">
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-hidden relative">
          {activeTab === 'editor' && <Workspace />}
          {activeTab === 'admin' && <AdminPanel />}
          {activeTab === 'settings' && <SettingsPanel />}
        </main>
      </div>
    </AuthContext.Provider>
  );
}

// --- Workspace Component ---
function Workspace() {
  const [code, setCode] = useState("print('Hello from Python Co-Lab!')");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [pyodideReady, setPyodideReady] = useState(false);
  const [pyodide, setPyodide] = useState<any>(null);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{role: 'user'|'assistant', content: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userMsg = chatInput;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsChatLoading(true);

    try {
      const res = await fetch('/api/copilot/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, code })
      });
      const data = await res.json();
      if (res.ok) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
      } else {
        setChatMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + (data.error || 'Failed to get response') }]);
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Error connecting to Co-pilot.' }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Fetch templates
  useEffect(() => {
    fetch('/api/templates')
      .then(res => res.json())
      .then(data => setTemplates(data))
      .catch(err => console.error('Failed to load templates:', err));
  }, []);

  const terminalRef = React.useRef<HTMLDivElement>(null);
  const xtermRef = React.useRef<Terminal | null>(null);

  // Initialize Pyodide
  useEffect(() => {
    const loadPyodideScript = async () => {
      if ((window as any).pyodide) {
        setPyodideReady(true);
        setPyodide((window as any).pyodide);
        return;
      }
      
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js';
      script.async = true;
      script.onload = async () => {
        try {
          const py = await (window as any).loadPyodide({
            stdout: (text: string) => {
              xtermRef.current?.writeln(text);
            },
            stderr: (text: string) => {
              xtermRef.current?.writeln('\\x1b[31m' + text + '\\x1b[0m');
            }
          });
          setPyodide(py);
          setPyodideReady(true);
          xtermRef.current?.writeln('\\x1b[32mPython 3.11 environment ready.\\x1b[0m');
          xtermRef.current?.write('> ');
        } catch (err) {
          xtermRef.current?.writeln('\\x1b[31mFailed to initialize Python environment.\\x1b[0m');
          console.error(err);
        }
      };
      document.body.appendChild(script);
    };
    
    loadPyodideScript();
  }, []);

  // Initialize xterm
  useEffect(() => {
    if (!terminalRef.current) return;
    
    const term = new Terminal({
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 14,
      convertEol: true,
    });
    
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();
    
    xtermRef.current = term;
    term.writeln('Initializing Python environment...');
    
    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, []);

  const runCode = async () => {
    if (!pyodideReady || !pyodide) return;
    
    xtermRef.current?.writeln('\\n\\x1b[33m> Running...\\x1b[0m');
    try {
      // Redirect stdout/stderr to our custom functions
      await pyodide.runPythonAsync(`
import sys
import io
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()
      `);
      
      await pyodide.runPythonAsync(code);
      
      const stdout = await pyodide.runPythonAsync("sys.stdout.getvalue()");
      const stderr = await pyodide.runPythonAsync("sys.stderr.getvalue()");
      
      if (stdout) xtermRef.current?.write(stdout);
      if (stderr) xtermRef.current?.write('\\x1b[31m' + stderr + '\\x1b[0m');
      
    } catch (err: any) {
      xtermRef.current?.writeln('\\x1b[31m' + err.toString() + '\\x1b[0m');
    }
    xtermRef.current?.write('> ');
  };

  const allTags = Array.from(new Set(templates.flatMap(t => t.tags.split(',').map(tag => tag.trim()))));
  
  const filteredTemplates = templates.filter(t => {
    const matchesSearch = t.title.toLowerCase().includes(searchQuery.toLowerCase()) || t.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTag = selectedTag ? t.tags.split(',').map(tag => tag.trim()).includes(selectedTag) : true;
    return matchesSearch && matchesTag;
  });

  return (
    <div className="flex h-full">
      {/* Left Sidebar: Templates */}
      <div className="w-64 border-r border-zinc-800 bg-zinc-900/30 flex flex-col shrink-0">
        <div className="p-4 border-b border-zinc-800">
          <h2 className="font-medium mb-3 flex items-center gap-2">
            <Search size={16} className="text-zinc-400" />
            Library
          </h2>
          <div className="relative">
            <input
              type="text"
              placeholder="Search templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:border-blue-500 transition-colors"
            />
            <Search size={14} className="absolute left-2.5 top-2 text-zinc-500" />
          </div>
          
          <div className="flex flex-wrap gap-1.5 mt-3">
            <button
              onClick={() => setSelectedTag(null)}
              className={`text-xs px-2 py-1 rounded-full border transition-colors ${!selectedTag ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-transparent border-zinc-800 text-zinc-400 hover:border-zinc-700'}`}
            >
              All
            </button>
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag)}
                className={`text-xs px-2 py-1 rounded-full border transition-colors ${selectedTag === tag ? 'bg-blue-500/20 border-blue-500/50 text-blue-300' : 'bg-transparent border-zinc-800 text-zinc-400 hover:border-zinc-700'}`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredTemplates.map(template => (
            <button
              key={template.id}
              onClick={() => setCode(template.code)}
              className="w-full text-left p-3 rounded-lg hover:bg-zinc-800/50 transition-colors group"
            >
              <div className="font-medium text-sm text-zinc-200 group-hover:text-white mb-1">{template.title}</div>
              <div className="text-xs text-zinc-500 line-clamp-2">{template.description}</div>
            </button>
          ))}
          {filteredTemplates.length === 0 && (
            <div className="p-4 text-center text-sm text-zinc-500">No templates found.</div>
          )}
        </div>
      </div>

      {/* Main Area: Editor & Terminal */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Editor Header */}
        <div className="h-12 border-b border-zinc-800 flex items-center justify-between px-4 bg-zinc-900/20 shrink-0">
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Code2 size={16} />
            <span>main.py</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsCopilotOpen(!isCopilotOpen)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${isCopilotOpen ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-transparent'}`}
            >
              <Bot size={16} />
              Co-pilot
            </button>
            <button
              onClick={runCode}
              disabled={!pyodideReady}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play size={16} />
              Run
            </button>
          </div>
        </div>
        
        {/* Editor */}
        <div className="flex-1 relative">
          <Editor
            height="100%"
            defaultLanguage="python"
            theme="vs-dark"
            value={code}
            onChange={(value) => setCode(value || '')}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              padding: { top: 16 },
              scrollBeyondLastLine: false,
            }}
          />
        </div>
        
        {/* Terminal */}
        <div className="h-64 border-t border-zinc-800 bg-[#1e1e1e] flex flex-col shrink-0">
          <div className="h-8 border-b border-zinc-800 flex items-center px-4 text-xs font-medium text-zinc-500 uppercase tracking-wider bg-zinc-900/50">
            <TerminalIcon size={14} className="mr-2" />
            Terminal Output
          </div>
          <div className="flex-1 p-2 overflow-hidden" ref={terminalRef}></div>
        </div>
      </div>

      {/* Right Sidebar: Co-pilot */}
      {isCopilotOpen && (
        <div className="w-80 border-l border-zinc-800 bg-zinc-900/50 flex flex-col shrink-0 shadow-xl z-10">
          <div className="h-12 border-b border-zinc-800 flex items-center px-4 shrink-0 bg-indigo-500/5">
            <Bot size={18} className="text-indigo-400 mr-2" />
            <span className="font-medium text-indigo-100">AI Co-pilot</span>
          </div>
          <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-4">
            <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-3 text-sm text-zinc-300">
              I can see your code. Ask me to explain it, find bugs, or suggest improvements.
            </div>
            {chatMessages.map((msg, idx) => (
              <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] rounded-lg p-3 text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-200 border border-zinc-700'}`}>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            ))}
            {isChatLoading && (
              <div className="flex items-start">
                <div className="bg-zinc-800 text-zinc-400 border border-zinc-700 rounded-lg p-3 text-sm">
                  Thinking...
                </div>
              </div>
            )}
          </div>
          <div className="p-3 border-t border-zinc-800 bg-zinc-900">
            <form onSubmit={handleChatSubmit} className="relative">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask Co-pilot..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 pl-3 pr-10 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                disabled={isChatLoading}
              />
              <button 
                type="submit" 
                className="absolute right-2 top-2 text-zinc-500 hover:text-indigo-400 transition-colors disabled:opacity-50" 
                disabled={isChatLoading || !chatInput.trim()}
              >
                <Play size={16} />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Admin Panel Component ---
function AdminPanel() {
  const [admittedUsers, setAdmittedUsers] = useState<{email: string, added_at: string}[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAdmitted();
  }, []);

  const fetchAdmitted = async () => {
    const res = await fetch('/api/admin/admitted');
    if (res.ok) {
      setAdmittedUsers(await res.json());
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/admin/admitted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newEmail })
    });
    
    if (res.ok) {
      setNewEmail('');
      fetchAdmitted();
    } else {
      const data = await res.json();
      setError(data.error || 'Failed to add user');
    }
  };

  const handleRemove = async (email: string) => {
    if (!confirm(`Remove ${email} from admitted users?`)) return;
    const res = await fetch(`/api/admin/admitted/${email}`, { method: 'DELETE' });
    if (res.ok) {
      fetchAdmitted();
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-2">Access Control</h1>
        <p className="text-zinc-400">Manage who can access the Python Co-Lab.</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800">
          <h2 className="text-lg font-medium mb-4">Admitted Users</h2>
          
          <form onSubmit={handleAdd} className="flex gap-3">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Enter email address"
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
              required
            />
            <button
              type="submit"
              className="bg-white text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors"
            >
              Add User
            </button>
          </form>
          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        </div>
        
        <div className="divide-y divide-zinc-800">
          {admittedUsers.map(user => (
            <div key={user.email} className="flex items-center justify-between p-4 hover:bg-zinc-800/30 transition-colors">
              <div>
                <div className="font-medium">{user.email}</div>
                <div className="text-xs text-zinc-500 mt-1">Added {new Date(user.added_at).toLocaleDateString()}</div>
              </div>
              <button
                onClick={() => handleRemove(user.email)}
                className="text-zinc-500 hover:text-red-400 px-3 py-1.5 rounded-md text-sm transition-colors"
              >
                Remove
              </button>
            </div>
          ))}
          {admittedUsers.length === 0 && (
            <div className="p-8 text-center text-zinc-500">No users admitted yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Settings Panel Component ---
function SettingsPanel() {
  const { user, refreshUser } = useContext(AuthContext);
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    
    try {
      const res = await fetch('/api/users/me/nickname', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname })
      });
      
      if (res.ok) {
        setMessage('Settings saved successfully.');
        refreshUser();
      } else {
        const data = await res.json();
        setMessage(data.error || 'Failed to save settings.');
      }
    } catch (err) {
      setMessage('An error occurred.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-2">Profile Settings</h1>
        <p className="text-zinc-400">Manage your personal information.</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-center gap-4 mb-8">
          <img src={user?.avatar_url} alt="Avatar" className="w-16 h-16 rounded-full border border-zinc-700" />
          <div>
            <div className="font-medium text-lg">{user?.email}</div>
            <div className="text-sm text-zinc-500">GitHub Account</div>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Nickname
            </label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500 transition-colors"
              required
            />
            <p className="text-xs text-zinc-500 mt-2">This is how other users will see you in the lab.</p>
          </div>
          
          <div className="flex items-center gap-4 pt-4 border-t border-zinc-800">
            <button
              type="submit"
              disabled={saving || nickname === user?.nickname}
              className="bg-white text-black px-6 py-2 rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Save size={16} />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            {message && <span className="text-sm text-zinc-400">{message}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}

