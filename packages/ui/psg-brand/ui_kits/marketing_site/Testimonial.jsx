// Testimonial.jsx — large pull quote with attribution
const Testimonial = () => (
  <section className="psg-section">
    <div className="container">
      <div className="psg-testimonial">
        <div>
          <span className="psg-eyebrow">Client perspective</span>
        </div>
        <div>
          <blockquote>PSG didn't show up with a deck. They showed up with a clipboard, walked the shop, and rebuilt our intake script before the end of week one. The estimate volume followed.</blockquote>
          <div className="psg-testimonial-meta">
            <div className="psg-testimonial-avatar">DM</div>
            <div>
              <div className="psg-testimonial-name">Daniel Marquez</div>
              <div className="psg-testimonial-role">Owner · Apex Collision Center, Tucson AZ</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

window.Testimonial = Testimonial;
