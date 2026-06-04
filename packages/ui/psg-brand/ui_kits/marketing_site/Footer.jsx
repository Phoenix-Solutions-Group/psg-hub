// Footer.jsx
const Footer = () => (
  <footer className="psg-footer">
    <div className="container">
      <div className="psg-footer-grid">
        <div>
          <img src="../../assets/psg-logo-reverse.svg" alt="" style={{height: 48, marginLeft: -12}}/>
          <p className="psg-footer-tagline">Strategic insight. Operational execution. Since 1989.</p>
        </div>
        <div>
          <h6>Capabilities</h6>
          <ul>
            <li><a href="#">Operational marketing</a></li>
            <li><a href="#">DRP performance</a></li>
            <li><a href="#">Local market growth</a></li>
            <li><a href="#">Customer experience</a></li>
          </ul>
        </div>
        <div>
          <h6>Industries</h6>
          <ul>
            <li><a href="#">Collision repair</a></li>
            <li><a href="#">MSO operators</a></li>
            <li><a href="#">Auto glass</a></li>
            <li><a href="#">Detail & ceramic</a></li>
          </ul>
        </div>
        <div>
          <h6>Contact</h6>
          <ul>
            <li><a href="#">hello@phoenixsolutionsgroup.net</a></li>
            <li><a href="#">(602) 555-0140</a></li>
            <li><a href="#">Phoenix, AZ</a></li>
          </ul>
        </div>
      </div>
      <div className="psg-footer-bottom">
        <span>© 2026 Phoenix Solutions Group. All rights reserved.</span>
        <span>Privacy · Terms · Accessibility</span>
      </div>
    </div>
  </footer>
);

window.Footer = Footer;
