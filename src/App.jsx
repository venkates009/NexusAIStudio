import React, { useState, useEffect } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import ReactMarkdown from 'react-markdown';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-css';
import './App.css';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);

const AGENTS = [
  { id: 'general', name: 'General Assistant', icon: '🤖', prompt: 'You are a helpful general-purpose AI assistant. Keep answers concise and helpful.', color: '#3b82f6' },
  { id: 'code', name: 'Code Expert', icon: '💻', prompt: 'You are an expert software engineer. Focus on clean code, patterns, and bug fixing. Always use markdown for code blocks.', color: '#10b981' },
  { id: 'data', name: 'Data Analyst', icon: '📊', prompt: 'You are a data scientist. Focus on trends, statistics, and logical reasoning.', color: '#f59e0b' },
  { id: 'writer', name: 'Creative Writer', icon: '✍️', prompt: 'You are a creative writer. Use expressive language and focus on storytelling and SEO.', color: '#ec4899' },
  { id: 'resume', name: 'Resume Architect', icon: '📄', prompt: 'You are a professional resume architect trained in Harvard and Google-standard resume templates.', color: '#8b5cf6' }
];

function App() {
  const [activeTab, setActiveTab] = useState('chat');
  const [activeAgent, setActiveAgent] = useState(() => {
    const saved = localStorage.getItem('nexus_active_agent');
    return saved ? JSON.parse(saved) : AGENTS[0];
  });

  useEffect(() => {
    localStorage.setItem('nexus_active_agent', JSON.stringify(activeAgent));
  }, [activeAgent]);

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="logo"><div className="logo-icon" style={{ background: activeAgent.color }}>{activeAgent.icon}</div><span>Nexus AI</span></div>
        <nav>
          <button className={activeTab === 'chat' ? 'active' : ''} onClick={() => setActiveTab('chat')}>Chat Studio</button>
          <button className={activeTab === 'agents' ? 'active' : ''} onClick={() => setActiveTab('agents')}>Agent Hub</button>
          <button className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}>Settings</button>
        </nav>
        <div className="active-agent-info"><small>Current Agent:</small><p>{activeAgent.name}</p></div>
      </aside>

      <main className="content">
        <header>
          <h1>{activeTab === 'chat' ? `Real-time: ${activeAgent.name}` : activeTab === 'agents' ? 'Multi-Agent Hub' : 'System Settings'}</h1>
          <div className="user-profile"><span style={{ color: '#10b981', marginRight: '8px' }}>●</span><span>Gemini 2.5 Flash Connected</span></div>
        </header>
        <div className="view-container">
          {activeTab === 'chat' && <ChatView activeAgent={activeAgent} />}
          {activeTab === 'agents' && <AgentsView setActiveAgent={setActiveAgent} setActiveTab={setActiveTab} />}
          {activeTab === 'settings' && <SettingsView />}
        </div>
      </main>
    </div>
  );
}

function ChatView({ activeAgent }) {
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem(`nexus_msgs_${activeAgent.id}`);
    return saved ? JSON.parse(saved) : [{ role: 'assistant', content: `Hello! I am your ${activeAgent.name}. How can I help you today?` }];
  });
  const [input, setInput] = useState('');
  const [knowledgeBase, setKnowledgeBase] = useState([]);
  const [indexedFiles, setIndexedFiles] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem(`nexus_msgs_${activeAgent.id}`, JSON.stringify(messages));
  }, [messages, activeAgent.id]);

  const downloadResumePDF = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const lastMsg = [...messages].reverse().find(m => m.role === 'assistant' && m.content.length > 100);
    if (!lastMsg) return;
    doc.setFont("helvetica", "bold"); doc.setFontSize(22);
    const lines = doc.splitTextToSize(lastMsg.content, 180);
    let y = 20;
    lines.forEach(line => {
      if (line.startsWith('#') || line.startsWith('**') || line.toUpperCase() === line) { doc.setFont("helvetica", "bold"); doc.setFontSize(14); y += 10; }
      else { doc.setFont("helvetica", "normal"); doc.setFontSize(11); y += 6; }
      doc.text(line.replace(/[#*]/g, ''), 15, y);
      if (y > 270) { doc.addPage(); y = 20; }
    });
    doc.save("Professional_Resume.pdf");
  };

  const extractTextFromPDF = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      fullText += textContent.items.map(item => item.str).join(" ") + "\n\n";
    }
    return fullText;
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsProcessing(true);
    try {
      let text = await (file.name.endsWith('.pdf') ? extractTextFromPDF(file) : file.text());
      let rawChunks = text.split('\n\n').filter(c => c.trim().length > 20);
      const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
      const chunksWithEmbeds = await Promise.all(rawChunks.slice(0, 10).map(async (chunk) => {
        try {
          const result = await embedModel.embedContent(chunk);
          return { text: chunk, embedding: result.embedding.values };
        } catch (e) { return { text: chunk, embedding: new Array(768).fill(0) }; }
      }));
      setKnowledgeBase(prev => [...prev, ...chunksWithEmbeds]);
      setIndexedFiles(prev => [...prev, file.name]);
      setMessages(prev => [...prev, { role: 'assistant', content: `Document "${file.name}" added to Knowledge Base.` }]);
    } catch (error) { setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error.message}` }]); }
    finally { setIsProcessing(false); }
  };

  const handleSend = async (overrideInput) => {
    const finalInput = overrideInput || input;
    if (!finalInput.trim() || isLoading) return;
    setSuggestions([]);
    setMessages(prev => [...prev, { role: 'user', content: finalInput }]);
    if (!overrideInput) setInput('');
    setIsLoading(true);

    try {
      const helpTerms = ['what to ask', 'summarize', 'help', 'don\'t know', 'therila'];
      if (helpTerms.some(t => finalInput.toLowerCase().includes(t)) && knowledgeBase.length > 0) {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(`Suggest 3 questions about these docs: ${knowledgeBase.slice(0,5).map(k=>k.text).join('\n')}. Format: Q1: [q]? Q2: [q]? Q3: [q]?`);
        const text = result.response.text();
        const qMatches = text.match(/Q\d: (.*?)\?/g) || [];
        setSuggestions(qMatches.map(q => q.replace(/Q\d: /, "").trim()));
        setMessages(prev => [...prev, { role: 'assistant', content: text }]);
        setIsLoading(false); return;
      }

      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const context = knowledgeBase.length > 0 ? `\nCONTEXT FROM DOCUMENTS:\n${knowledgeBase.slice(0, 10).map(k => k.text).join("\n")}` : "";
      const result = await model.generateContentStream(`SYSTEM: ${activeAgent.prompt}${context}\n\nUSER: ${finalInput}`);
      let fullResponse = "";
      setMessages(prev => [...prev, { role: 'assistant', content: "" }]);
      for await (const chunk of result.stream) {
        fullResponse += chunk.text();
        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1].content = fullResponse;
          return newMessages;
        });
      }
    } catch (error) { setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error.message}` }]); }
    finally { setIsLoading(false); }
  };

  return (
    <div className="chat-view">
      <div className="message-list">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="message-bubble"><ReactMarkdown>{msg.content}</ReactMarkdown></div>
          </div>
        ))}
        {isLoading && <div className="message assistant"><div className="message-bubble">Thinking...</div></div>}
      </div>
      <div className="chat-footer">
        {indexedFiles.length > 0 && (
          <div className="kb-badge" style={{ marginBottom: '10px' }}>
            Files Active: {indexedFiles.join(', ')} ({knowledgeBase.length} chunks)
          </div>
        )}
        {suggestions.length > 0 && (
          <div className="suggestions-area">
            {suggestions.map((q, i) => <button key={i} className="suggestion-btn" onClick={() => handleSend(q)}>{q}</button>)}
          </div>
        )}
        <div className="chat-controls" style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px 20px' }}>
          {activeAgent.id === 'resume' && messages.length > 2 && (
            <button className="export-btn" style={{ background: '#8b5cf6', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', alignSelf: 'flex-start' }} onClick={downloadResumePDF}>📥 Download Professional Resume</button>
          )}
          <div className="input-area">
            <label className="upload-btn"><input type="file" onChange={handleFileUpload} accept=".pdf,.docx,.txt" style={{ display: 'none' }} />📎</label>
            <input type="text" placeholder={`Ask ${activeAgent.name}...`} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} />
            <button onClick={() => handleSend()}>Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentsView({ setActiveAgent, setActiveTab }) {
  const handleActivate = (agent) => { setActiveAgent(agent); setActiveTab('chat'); };
  return (
    <div className="agents-grid">
      {AGENTS.map((agent) => (
        <div key={agent.id} className="agent-card" style={{ borderColor: agent.color + '33' }}>
          <div className="agent-icon" style={{ background: agent.color }}>{agent.icon}</div>
          <h3>{agent.name}</h3><p>{agent.prompt}</p>
          <button className="activate-btn" style={{ '--hover-color': agent.color }} onClick={() => handleActivate(agent)}>Activate Agent</button>
        </div>
      ))}
    </div>
  );
}

function SettingsView() { return <div className="settings-view"><div className="setting-item"><label>Model</label><select><option>Gemini 2.5 Flash</option></select></div></div>; }

export default App;
