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
  { id: 'resume', name: 'Resume Optimizer', icon: '📄', prompt: 'You are a professional resume writer. When a user provides resume details, always output the full updated resume in a valid JSON block inside [RESUME_JSON]...[/RESUME_JSON] tags so it can be previewed.', color: '#8b5cf6' }
];

function App() {
  const [activeTab, setActiveTab] = useState('chat');
  const [activeAgent, setActiveAgent] = useState(AGENTS[0]);

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
  const [messages, setMessages] = useState([{ role: 'assistant', content: `Hello! I am your ${activeAgent.name}. ${activeAgent.prompt}` }]);
  const [input, setInput] = useState('');
  const [knowledgeBase, setKnowledgeBase] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [resumeData, setResumeData] = useState(null);

  const downloadAsPDF = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    if (!resumeData) return;
    doc.setFontSize(18); doc.text(resumeData.name || "Resume", 10, 20);
    doc.setFontSize(10); doc.text(resumeData.contact?.join(" | ") || "", 10, 28);
    doc.setFontSize(14); doc.text("Professional Summary", 10, 40);
    doc.setFontSize(10); doc.text(doc.splitTextToSize(resumeData.summary || "", 180), 10, 48);
    doc.save("Updated_Resume.pdf");
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsProcessing(true);
    try {
      let text = "";
      if (file.type === "application/pdf" || file.name.endsWith(".pdf")) text = await extractTextFromPDF(file);
      else if (file.name.endsWith(".docx")) text = await extractTextFromDOCX(file);
      else text = await file.text();

      let rawChunks = text.split('\n\n').filter(c => c.trim().length > 20);
      const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
      const chunksWithEmbeds = await Promise.all(rawChunks.slice(0, 15).map(async (chunk) => {
        try {
          const result = await embedModel.embedContent(chunk);
          return { text: chunk, embedding: result.embedding.values };
        } catch (e) { return { text: chunk, embedding: new Array(768).fill(0) }; }
      }));
      setKnowledgeBase(chunksWithEmbeds);

      // Trigger structural extraction for Resume Agent
      if (activeAgent.id === 'resume') {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(`Extract resume details from this text and output it ONLY as a JSON block inside [RESUME_JSON]...[/RESUME_JSON]. Fields: name, contact (array), maritalStatus, summary, experience (array of {company, role, years, details}), skills (array). TEXT: ${text.slice(0, 4000)}`);
        const responseText = result.response.text();
        const jsonMatch = responseText.match(/\[RESUME_JSON\]([\s\S]*?)\[\/RESUME_JSON\]/);
        if (jsonMatch) setResumeData(JSON.parse(jsonMatch[1]));
      }

      setMessages(prev => [...prev, { role: 'assistant', content: `Document "${file.name}" indexed successfully.` }]);
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
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const context = knowledgeBase.length > 0 ? `\nCONTEXT: ${knowledgeBase.slice(0, 3).map(k => k.text).join("\n")}` : "";
      
      const prompt = `
        SYSTEM: ${activeAgent.prompt}
        ${context}
        ${resumeData ? `CURRENT RESUME DATA: ${JSON.stringify(resumeData)}` : ""}
        
        USER REQUEST: ${finalInput}
        
        INSTRUCTIONS: If this is the Resume Optimizer agent, always provide the full updated resume JSON inside [RESUME_JSON]...[/RESUME_JSON] tags after your response.
      `;

      const result = await model.generateContentStream(prompt);
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

      // Parse JSON update
      const jsonMatch = fullResponse.match(/\[RESUME_JSON\]([\s\S]*?)\[\/RESUME_JSON\]/);
      if (jsonMatch) {
        try { setResumeData(JSON.parse(jsonMatch[1])); } catch (e) { console.error("JSON Parse Error", e); }
      }

    } catch (error) { setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error.message}` }]); }
    finally { setIsLoading(false); }
  };

  return (
    <div className="split-view">
      <div className="chat-view">
        <div className="message-list">
          {messages.map((msg, i) => (
            <div key={i} className={`message ${msg.role}`}>
              <div className="message-bubble">
                <ReactMarkdown>{msg.content.replace(/\[RESUME_JSON\][\s\S]*?\[\/RESUME_JSON\]/, "")}</ReactMarkdown>
              </div>
            </div>
          ))}
          {isLoading && <div className="message assistant"><div className="message-bubble">Updating Resume...</div></div>}
        </div>
        <div className="chat-footer">
          {activeAgent.id === 'resume' && resumeData && <button className="export-btn" onClick={downloadAsPDF}>📥 Download PDF</button>}
          <div className="input-area">
            <label className="upload-btn"><input type="file" onChange={handleFileUpload} accept=".pdf,.docx,.txt" style={{ display: 'none' }} />📎</label>
            <input type="text" placeholder={`Edit resume with ${activeAgent.name}...`} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} />
            <button onClick={() => handleSend()}>Update</button>
          </div>
        </div>
      </div>
      
      <div className="resume-preview-panel">
        {resumeData ? (
          <>
            <h1>{resumeData.name}</h1>
            <div className="contact-info">
              {resumeData.contact?.map((c, i) => <span key={i}>{c}</span>)}
              {resumeData.maritalStatus && <span>Status: {resumeData.maritalStatus}</span>}
            </div>
            <h3>Professional Summary</h3>
            <p>{resumeData.summary}</p>
            <h3>Experience</h3>
            {resumeData.experience?.map((exp, i) => (
              <div key={i} style={{ marginBottom: '15px' }}>
                <strong style={{ display: 'block' }}>{exp.company} | {exp.role} ({exp.years})</strong>
                {exp.details && <p>{exp.details}</p>}
              </div>
            ))}
            <h3>Skills</h3>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {resumeData.skills?.map((s, i) => <span key={i} style={{ background: '#f1f5f9', padding: '4px 10px', borderRadius: '4px', fontSize: '0.85rem' }}>{s}</span>)}
            </div>
          </>
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', textAlign: 'center' }}>
            <p>Upload your resume and activate Resume Optimizer<br/>to see a live interactive preview here.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ... (Helper functions outside)
async function extractTextFromPDF(file) {
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
}

async function extractTextFromDOCX(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer });
  return result.value;
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
