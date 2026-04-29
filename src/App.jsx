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
  { id: 'writer', name: 'Creative Writer', icon: '✍️', prompt: 'You are a creative writer. Use expressive language and focus on storytelling and SEO.', color: '#ec4899' }
];

function App() {
  const [activeTab, setActiveTab] = useState('chat');
  const [activeAgent, setActiveAgent] = useState(AGENTS[0]);

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon" style={{ background: activeAgent.color }}>{activeAgent.icon}</div>
          <span>Nexus AI</span>
        </div>
        <nav>
          <button
            className={activeTab === 'chat' ? 'active' : ''}
            onClick={() => setActiveTab('chat')}
          >
            Chat Studio
          </button>
          <button
            className={activeTab === 'agents' ? 'active' : ''}
            onClick={() => setActiveTab('agents')}
          >
            Agent Hub
          </button>
          <button
            className={activeTab === 'settings' ? 'active' : ''}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
        </nav>
        <div className="active-agent-info">
          <small>Current Agent:</small>
          <p>{activeAgent.name}</p>
        </div>
      </aside>

      <main className="content">
        <header>
          <h1>{activeTab === 'chat' ? `Real-time: ${activeAgent.name}` : activeTab === 'agents' ? 'Multi-Agent Hub' : 'System Settings'}</h1>
          <div className="user-profile">
            <span style={{ color: '#10b981', marginRight: '8px' }}>●</span>
            <span>Gemini 2.5 Flash Connected</span>
          </div>
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
  const [messages, setMessages] = useState([
    { role: 'assistant', content: `Hello! I am your ${activeAgent.name}. ${activeAgent.prompt}` }
  ]);
  const [input, setInput] = useState('');
  const [knowledgeBase, setKnowledgeBase] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const extractTextFromPDF = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(" ");
      fullText += pageText + "\n\n";
    }
    return fullText;
  };

  const extractTextFromDOCX = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const result = await window.mammoth.extractRawText({ arrayBuffer });
    return result.value;
  };

  // Helper for Semantic Search (Cosine Similarity)
  const cosineSimilarity = (vecA, vecB) => {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      let text = "";
      if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
        text = await extractTextFromPDF(file);
      } else if (file.name.endsWith(".docx")) {
        text = await extractTextFromDOCX(file);
      } else {
        text = await file.text();
      }

      let rawChunks = text.split('\n\n').filter(c => c.trim().length > 20);
      
      // Fallback: If no double newlines, split by single newlines and group
      if (rawChunks.length === 0) {
        rawChunks = text.split('\n').filter(c => c.trim().length > 50);
      }
      
      // Still nothing? Just take the whole text if it's long enough
      if (rawChunks.length === 0 && text.length > 20) {
        rawChunks = [text];
      }

      // Generate Embeddings for each chunk
      const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
      const chunksWithEmbeds = await Promise.all(rawChunks.map(async (chunk) => {
        try {
          const result = await embedModel.embedContent(chunk);
          return { text: chunk, embedding: result.embedding.values };
        } catch (e) {
          console.warn("Embedding failed for chunk, using empty vector:", e);
          return { text: chunk, embedding: new Array(768).fill(0) }; // Fallback
        }
      }));

      setKnowledgeBase(chunksWithEmbeds);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Knowledge base updated with "${file.name}". I've created vector embeddings for ${chunksWithEmbeds.length} chunks to enable Semantic Search.`
      }]);
    } catch (error) {
      console.error("File processing error:", error);
      const errorMessage = error.message || "Unknown file error";
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `Error processing file: ${errorMessage}. Please check the console for details.` 
      }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // 1. Vector Search (Semantic Retrieval)
      let relevantChunks = [];
      if (knowledgeBase.length > 0) {
        try {
          const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
          const queryResult = await embedModel.embedContent(input);
          const queryVector = queryResult.embedding.values;

          relevantChunks = knowledgeBase
            .map(item => ({
              ...item,
              similarity: cosineSimilarity(queryVector, item.embedding)
            }))
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, 3)
            .filter(item => item.similarity > 0.4) // Lowered threshold slightly for better recall
            .map(item => item.text);
        } catch (searchError) {
          console.warn("Semantic search failed, falling back to basic RAG:", searchError);
          // Simple keyword fallback
          relevantChunks = knowledgeBase
            .filter(item => item.text.toLowerCase().includes(input.toLowerCase().slice(0, 5)))
            .slice(0, 2)
            .map(item => item.text);
        }
      }

      const contextText = relevantChunks.length > 0
        ? `\n\nCONTEXT FROM UPLOADED DOCUMENTS:\n${relevantChunks.join('\n---\n')}`
        : "";

      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const prompt = `
        SYSTEM INSTRUCTIONS: ${activeAgent.prompt}
        ${contextText}
        
        USER QUESTION: ${input}
        
        INSTRUCTIONS: Use the context provided above if available. If not available, use your general knowledge as ${activeAgent.name}.
      `;

      // 3. Streaming Response Logic
      const result = await model.generateContentStream(prompt);
      
      // Initialize an empty message for the assistant
      let fullResponse = "";
      setMessages(prev => [...prev, { role: 'assistant', content: "" }]);

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        fullResponse += chunkText;
        
        // Update the last message in the list
        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1].content = fullResponse;
          return newMessages;
        });
      }

    } catch (error) {
      console.error("Gemini Error:", error);
      const errorMessage = error.message || "Unknown error";
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Gemini API Error: ${errorMessage}. Please verify your API key and connection.`
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    Prism.highlightAll();
  }, [messages]);

  return (
    <div className="chat-view">
      <div className="message-list">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="message-bubble">
              {msg.role === 'assistant' ? (
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              ) : (
                <p>{msg.content}</p>
              )}
            </div>
          </div>
        ))}
        {isProcessing && <div className="message assistant"><div className="message-bubble">Processing document...</div></div>}
        {isLoading && <div className="message assistant"><div className="message-bubble">Thinking...</div></div>}
      </div>
      <div className="input-area">
        <label className="upload-btn">
          <input type="file" onChange={handleFileUpload} accept=".txt,.md,.pdf,.docx" style={{ display: 'none' }} />
          📎
        </label>
        <input
          type="text"
          placeholder={`Ask ${activeAgent.name}...`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <button onClick={handleSend}>Send</button>
      </div>
      {knowledgeBase.length > 0 && (
        <div className="kb-badge">
          Knowledge Base Active: {knowledgeBase.length} chunks indexed
        </div>
      )}
    </div>
  );
}

function AgentsView({ setActiveAgent, setActiveTab }) {
  const handleActivate = (agent) => {
    setActiveAgent(agent);
    setActiveTab('chat');
  };

  return (
    <div className="agents-grid">
      {AGENTS.map((agent) => (
        <div key={agent.id} className="agent-card" style={{ borderColor: agent.color + '33' }}>
          <div className="agent-icon" style={{ background: agent.color }}>{agent.icon}</div>
          <h3>{agent.name}</h3>
          <p>{agent.prompt}</p>
          <button
            className="activate-btn"
            style={{ '--hover-color': agent.color }}
            onClick={() => handleActivate(agent)}
          >
            Activate Agent
          </button>
        </div>
      ))}
    </div>
  );
}

function SettingsView() {
  return (
    <div className="settings-view">
      <div className="setting-item">
        <label>Select Model</label>
        <select>
          <option>Gemini 1.5 Pro</option>
          <option>GPT-4o</option>
          <option>Claude 3.5 Sonnet</option>
        </select>
      </div>
    </div>
  );
}

export default App;
