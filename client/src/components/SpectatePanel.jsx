import React, { useState } from 'react';
import Editor from '@monaco-editor/react';

const LANG_MAP = {
  jsx:'javascript', tsx:'typescript', js:'javascript', ts:'typescript',
  css:'css', html:'html', json:'json', py:'python',
  java:'java', cpp:'cpp', md:'markdown', sh:'shell',
};
function getLang(filename) {
  const ext = filename?.split('.').pop() || 'js';
  return LANG_MAP[ext] || 'javascript';
}
function roleColor(role) {
  return { frontend:'#61dafb', backend:'#10b981', fullstack:'#f59e0b', viewer:'#a78bfa' }[role] || '#94a3b8';
}

export default function SpectatePanel({ files, activeFile, targetUser }) {
  const [localFile, setLocalFile] = useState(null);

  if (!targetUser) return (
    <div style={{ height:'100%',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--muted)',fontFamily:'JetBrains Mono,monospace',fontSize:'13px' }}>
      Waiting for snapshot…
    </div>
  );

  const displayed = localFile && files[localFile] ? localFile : activeFile;
  const fileList = Object.keys(files || {});
  const currentFile = files?.[displayed];

  return (
    <div style={{ display:'flex',flexDirection:'column',height:'100%',overflow:'hidden' }}>
      {/* Header */}
      <div style={{
        display:'flex',alignItems:'center',gap:'10px',
        padding:'8px 14px',
        background:'var(--surface)',borderBottom:'1px solid var(--border)',
        flexShrink:0,
      }}>
        <div style={{
          width:'28px',height:'28px',borderRadius:'50%',
          background: targetUser.role === 'frontend' ? 'linear-gradient(135deg,#0ea5e9,#6366f1)'
                    : targetUser.role === 'backend'   ? 'linear-gradient(135deg,#10b981,#059669)'
                    : targetUser.role === 'fullstack' ? 'linear-gradient(135deg,#f59e0b,#ef4444)'
                    : 'linear-gradient(135deg,#64748b,#334155)',
          display:'flex',alignItems:'center',justifyContent:'center',
          fontSize:'12px',fontWeight:'800',
        }}>
          {targetUser.name[0].toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize:'12px',fontWeight:'700' }}>
            Watching {targetUser.name}
          </div>
          <div style={{ fontSize:'10px',color:roleColor(targetUser.role),fontFamily:'JetBrains Mono,monospace' }}>
            {targetUser.role}
          </div>
        </div>
        <div style={{ marginLeft:'auto',fontSize:'10px',color:'var(--warn)',fontFamily:'JetBrains Mono,monospace',letterSpacing:'.5px' }}>
          ◉ LIVE VIEW
        </div>
      </div>

      {/* File tabs */}
      <div style={{
        display:'flex',background:'var(--surface)',borderBottom:'1px solid var(--border)',
        overflowX:'auto',flexShrink:0,height:'34px',alignItems:'stretch',scrollbarWidth:'none',
      }}>
        {fileList.map(path => {
          const fname = path.split('/').pop();
          const isActive = path === displayed;
          return (
            <div key={path}
              onClick={() => setLocalFile(path)}
              style={{
                display:'flex',alignItems:'center',padding:'0 12px',
                fontSize:'11px',fontFamily:'JetBrains Mono,monospace',
                color: isActive ? 'var(--text)' : 'var(--muted)',
                background: isActive ? 'var(--panel)' : 'transparent',
                borderBottom: isActive ? '2px solid var(--warn)' : '2px solid transparent',
                borderRight:'1px solid var(--border)',cursor:'pointer',whiteSpace:'nowrap',
                transition:'all .15s',
              }}
            >
              {fname}
              {path === activeFile && (
                <span style={{ width:'5px',height:'5px',borderRadius:'50%',background:'var(--warn)',marginLeft:'5px',display:'inline-block' }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Editor (read-only) */}
      <div style={{ flex:1,overflow:'hidden',position:'relative' }}>
        {currentFile ? (
          <>
            <div style={{
              position:'absolute',top:'8px',right:'8px',zIndex:10,
              background:'rgba(245,158,11,.9)',color:'#000',
              fontSize:'10px',fontFamily:'JetBrains Mono,monospace',
              padding:'2px 8px',borderRadius:'3px',letterSpacing:'.5px',
              pointerEvents:'none',
            }}>
              {targetUser.name} · {displayed?.split('/').pop()}
            </div>
            <Editor
              height="100%"
              language={getLang(displayed)}
              value={currentFile.content || ''}
              theme="stackroom"
              options={{
                readOnly: true,
                fontSize: 12.5,
                lineHeight: 20,
                fontFamily: "'JetBrains Mono', monospace",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                renderLineHighlight: 'line',
                padding: { top: 12 },
                domReadOnly: true,
                cursorStyle: 'line-thin',
              }}
            />
          </>
        ) : (
          <div style={{ height:'100%',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--muted)',fontFamily:'JetBrains Mono,monospace',fontSize:'12px' }}>
            No files to display
          </div>
        )}
      </div>
    </div>
  );
}
