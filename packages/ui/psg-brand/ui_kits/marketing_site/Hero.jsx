// Hero.jsx — opening editorial split with stat aside
const Hero = ({ onPrimary, onSecondary }) => (
  <section className="psg-hero">
    <div className="container">
      <div className="psg-hero-grid">
        <div>
          <span className="psg-eyebrow">35 Years of Transformation</span>
          <h1>Marketing built around <em>your bay schedule.</em> Not the other way around.</h1>
          <p>Phoenix Solutions Group operates at the intersection of strategic insight and operational execution — a partnership built for collision repair leaders who measure success in cycle time, CSI, and lifetime value.</p>
          <div className="psg-hero-actions">
            <button className="psg-btn psg-btn-primary" onClick={onPrimary}>
              Schedule a consultation
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M17 7H8M17 7V16"/></svg>
            </button>
            <button className="psg-btn psg-btn-ghost" onClick={onSecondary}>
              View our approach →
            </button>
          </div>
        </div>
        <aside className="psg-hero-aside">
          <div className="psg-hero-aside-stat">
            <span className="num">35<span style={{fontSize:'28px',color:'var(--psg-ember)'}}>+</span></span>
            <div className="lbl">Years in market · Est. 1989</div>
          </div>
          <div className="psg-hero-aside-stat">
            <span className="num">240</span>
            <div className="lbl">Shops served across 38 states</div>
          </div>
          <div className="psg-hero-aside-stat">
            <span className="num">94<span style={{fontSize:'28px'}}>%</span></span>
            <div className="lbl">Client retention, year over year</div>
          </div>
        </aside>
      </div>
    </div>
  </section>
);

window.Hero = Hero;
