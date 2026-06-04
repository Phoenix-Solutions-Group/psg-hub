// CapabilityGrid.jsx — 3x2 grid of capabilities, editorial style
const Capabilities = [
  { num: '01', icon: 'M12 2v6m0 8v6M4.93 4.93l4.24 4.24m5.66 5.66l4.24 4.24M2 12h6m8 0h6M4.93 19.07l4.24-4.24m5.66-5.66l4.24-4.24', title: 'Operational marketing', body: 'Campaigns calibrated to your bay capacity, technician headcount, and parts cycle. We market to fill the schedule, not chase volume.' },
  { num: '02', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', title: 'DRP performance', body: 'Cycle time, severity, and CSI benchmarks measured against your insurer\'s targets. Quarterly reviews in plain English.' },
  { num: '03', icon: 'M3 3v18h18M7 14l4-4 4 4 5-5', title: 'Local market growth', body: 'Search, reputation, and referral systems built for a 15-mile radius. Measured in estimates, not impressions.' },
  { num: '04', icon: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z', title: 'Customer experience', body: 'From first call to five-star review — the touchpoints between estimate and delivery, refined.' },
  { num: '05', icon: 'M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75M9 7a4 4 0 100 8 4 4 0 000-8z', title: 'Team & training', body: 'Front-of-house scripts, estimator coaching, and shop-wide alignment on the customer story.' },
  { num: '06', icon: 'M9 11H7v9h2v-9zm4-7h-2v16h2V4zm4 11h-2v5h2v-5zm5 5H1v2h21v-2z', title: 'Reporting & insight', body: 'Monthly metrics that tie marketing spend to closed jobs. Dashboards built for shop owners, not analysts.' },
];

const CapabilityGrid = () => (
  <section className="psg-section" id="capabilities">
    <div className="container">
      <div className="psg-section-header">
        <div>
          <span className="psg-eyebrow">Capabilities</span>
          <h2>Six disciplines. One playbook.</h2>
        </div>
        <p>We bring the full weight of an integrated agency to a single shop. Every engagement begins with a 90-day diagnostic — what's working, what's leaking, what to fix first.</p>
      </div>
      <div className="psg-cap-grid">
        {Capabilities.map(c => (
          <div className="psg-cap-cell" key={c.num}>
            <svg className="psg-cap-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d={c.icon}/></svg>
            <div className="psg-cap-num">{c.num}</div>
            <h3>{c.title}</h3>
            <p>{c.body}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

window.CapabilityGrid = CapabilityGrid;
