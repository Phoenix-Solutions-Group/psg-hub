// Proof.jsx — dark band with stats
const Proof = () => (
  <section className="psg-section psg-section-dark">
    <div className="container">
      <div className="psg-section-header" style={{marginBottom: 48}}>
        <div>
          <span className="psg-eyebrow" style={{color:'#D88378'}}>Proof, in numbers</span>
          <h2 style={{color:'var(--psg-paper)'}}>Measured outcomes, not vanity metrics.</h2>
        </div>
        <p style={{color:'var(--psg-fog)'}}>The averages below reflect twelve months of partnership across our active collision-repair client base.</p>
      </div>
      <div className="psg-proof">
        <div className="psg-proof-item"><span className="num">+38<span style={{fontSize:'24px'}}>%</span></span><div className="lbl">Estimate volume</div></div>
        <div className="psg-proof-item"><span className="num">−4.2<span style={{fontSize:'24px'}}>d</span></span><div className="lbl">Cycle time reduction</div></div>
        <div className="psg-proof-item"><span className="num">4.9<span style={{fontSize:'24px',color:'var(--psg-ember-65)'}}>★</span></span><div className="lbl">Average CSI score</div></div>
        <div className="psg-proof-item"><span className="num">94<span style={{fontSize:'24px'}}>%</span></span><div className="lbl">Annual retention</div></div>
      </div>
    </div>
  </section>
);

window.Proof = Proof;
