// CtaBanner.jsx — closing CTA on midnight
const CtaBanner = ({ onClick }) => (
  <section className="psg-cta-banner">
    <div className="container-narrow">
      <span className="psg-eyebrow" style={{color:'#D88378'}}>Begin a partnership</span>
      <h2>Ready when you are.<br/>The first conversation is on us.</h2>
      <p>Tell us about your shop. We'll respond within one business day with a tailored read of where to start.</p>
      <button className="psg-btn psg-btn-on-dark" onClick={onClick}>
        Schedule a consultation
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M17 7H8M17 7V16"/></svg>
      </button>
    </div>
  </section>
);

window.CtaBanner = CtaBanner;
