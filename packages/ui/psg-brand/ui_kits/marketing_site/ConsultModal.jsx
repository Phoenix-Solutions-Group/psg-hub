// ConsultModal.jsx — pop-up consultation form
const ConsultModal = ({ open, onClose }) => {
  const [submitted, setSubmitted] = React.useState(false);
  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0, zIndex:100,
      background:'rgba(250,248,245,0.65)', backdropFilter:'blur(12px)',
      display:'flex', alignItems:'center', justifyContent:'center', padding: '24px'
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:'#fff', borderRadius:8, padding:'48px 44px',
        maxWidth:520, width:'100%',
        border:'1px solid var(--color-border)',
        boxShadow:'var(--shadow-xl)'
      }}>
        {!submitted ? (
          <>
            <span className="psg-eyebrow">Schedule a consultation</span>
            <h3 style={{fontFamily:'var(--font-display)', fontSize:28, fontWeight:400, color:'var(--psg-midnight)', margin:'14px 0 8px', letterSpacing:'-0.012em'}}>Tell us about your shop.</h3>
            <p style={{fontSize:14, color:'var(--psg-graphite)', margin:'0 0 28px', lineHeight:1.6}}>We'll respond within one business day.</p>
            <form onSubmit={e => { e.preventDefault(); setSubmitted(true); }}>
              <label style={lblS}>Shop name</label>
              <input style={inputS} placeholder="Apex Collision Center" required/>
              <label style={lblS}>Your name</label>
              <input style={inputS} placeholder="Daniel Marquez" required/>
              <label style={lblS}>Email</label>
              <input style={inputS} type="email" placeholder="you@shop.com" required/>
              <label style={lblS}>Monthly volume</label>
              <select style={inputS}>
                <option>Under 75 jobs</option>
                <option>75–150 jobs</option>
                <option>150–300 jobs</option>
                <option>300+ jobs</option>
              </select>
              <div style={{display:'flex', gap:12, marginTop:24, justifyContent:'flex-end'}}>
                <button type="button" className="psg-btn psg-btn-ghost" onClick={onClose}>Cancel</button>
                <button type="submit" className="psg-btn psg-btn-primary">Send inquiry</button>
              </div>
            </form>
          </>
        ) : (
          <div style={{textAlign:'center', padding:'24px 0'}}>
            <div style={{width:56, height:56, borderRadius:'50%', background:'var(--psg-ember-95)', color:'var(--psg-ember)', display:'inline-flex', alignItems:'center', justifyContent:'center', marginBottom:20}}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>
            </div>
            <h3 style={{fontFamily:'var(--font-display)', fontSize:28, fontWeight:400, color:'var(--psg-midnight)', margin:'0 0 12px', letterSpacing:'-0.012em'}}>Inquiry received.</h3>
            <p style={{fontSize:15, color:'var(--psg-graphite)', margin:'0 auto 28px', maxWidth:360, lineHeight:1.6}}>A member of the PSG team will reach out within one business day.</p>
            <button className="psg-btn psg-btn-secondary" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
};
const lblS = {display:'block', fontFamily:'var(--font-display)', fontSize:11, fontWeight: 500, textTransform:'uppercase', letterSpacing:'0.12em', color:'var(--psg-graphite)', marginBottom:6, marginTop:14};
const inputS = {width:'100%', fontFamily:'var(--font-body)', fontSize:14, padding:'11px 14px', border:'1px solid var(--color-border)', borderRadius:6, background:'#fff', color:'var(--psg-graphite)', boxSizing:'border-box', outline:'none'};

window.ConsultModal = ConsultModal;
