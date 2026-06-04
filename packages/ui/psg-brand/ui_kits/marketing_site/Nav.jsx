// Nav.jsx — sticky top navigation
const Nav = ({ onCtaClick }) => {
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const links = ['Capabilities', 'Industries', 'Approach', 'Insights', 'About'];

  return (
    <nav className={`psg-nav ${scrolled ? 'scrolled' : ''}`}>
      <div className="psg-nav-inner">
        <a href="#" className="psg-nav-logo" style={{ border: 'none' }}>
          <img src="../../assets/psg-logo-horizontal.svg" alt="Phoenix Solutions Group" />
        </a>
        <div className="psg-nav-links">
          {links.map(l => (
            <a key={l} className="psg-nav-link" href={`#${l.toLowerCase()}`}>{l}</a>
          ))}
          <button className="psg-nav-cta" onClick={onCtaClick}>Schedule consultation</button>
        </div>
      </div>
    </nav>
  );
};

window.Nav = Nav;
