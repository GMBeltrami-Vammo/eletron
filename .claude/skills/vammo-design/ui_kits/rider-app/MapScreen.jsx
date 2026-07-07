// MapScreen — styled São Paulo street map (Vila Madalena · Pinheiros style)
// with neighborhoods, streets, park (Ibirapuera), Pinheiros river, and yellow
// battery-station pins.

function MapStyledSvg() {
  return (
    <svg className="ra-map-svg" viewBox="0 0 360 720" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="parkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#D4E4C5"/>
          <stop offset="100%" stopColor="#C2D6B1"/>
        </linearGradient>
      </defs>

      {/* Background — warm beige */}
      <rect width="360" height="720" fill="#EFE9DC"/>

      {/* Neighborhood blocks — soft lighter rectangles to suggest building plots */}
      <g fill="#F4EFE2" opacity="0.9">
        <rect x="20"  y="40"  width="92"  height="80" rx="3"/>
        <rect x="125" y="40"  width="115" height="65" rx="3"/>
        <rect x="250" y="40"  width="95"  height="90" rx="3"/>
        <rect x="20"  y="135" width="60"  height="55" rx="3"/>
        <rect x="92"  y="120" width="135" height="48" rx="3"/>
        <rect x="240" y="145" width="105" height="60" rx="3"/>
        <rect x="20"  y="205" width="85"  height="70" rx="3"/>
        <rect x="118" y="183" width="72"  height="92" rx="3"/>
        <rect x="20"  y="290" width="48"  height="90" rx="3"/>
        <rect x="80"  y="290" width="100" height="60" rx="3"/>
        <rect x="245" y="290" width="100" height="78" rx="3"/>
        <rect x="20"  y="395" width="70"  height="60" rx="3"/>
        <rect x="103" y="365" width="95"  height="98" rx="3"/>
        <rect x="20"  y="470" width="120" height="80" rx="3"/>
        <rect x="155" y="478" width="80"  height="65" rx="3"/>
        <rect x="248" y="478" width="100" height="74" rx="3"/>
        <rect x="20"  y="565" width="90"  height="85" rx="3"/>
        <rect x="125" y="558" width="110" height="92" rx="3"/>
      </g>

      {/* Ibirapuera Park — a long green oval on the right */}
      <path d="M 215 215 Q 250 200 305 230 Q 360 250 350 320 Q 348 360 305 380 Q 260 388 230 360 Q 200 330 215 270 Z"
            fill="url(#parkGrad)"/>
      {/* park inner detail — lighter green */}
      <path d="M 240 245 Q 270 235 305 255 Q 325 270 320 310 Q 310 340 280 345 Q 250 348 235 320 Q 230 295 240 270 Z"
            fill="#C8DBB6" opacity="0.7"/>

      {/* Pinheiros River — narrow blue ribbon angled NE→SW */}
      <path d="M 0 290 Q 30 285 60 300 Q 90 315 120 325 L 110 360 Q 80 350 50 340 Q 25 332 0 330 Z"
            fill="#BFD7E6" opacity="0.85"/>
      <path d="M 0 290 Q 30 285 60 300 Q 90 315 120 325"
            stroke="#A6C3D6" strokeWidth="1" fill="none"/>

      {/* Major avenues — wide white strokes, slight angle */}
      <g stroke="#FFFFFF" strokeLinecap="square" fill="none">
        {/* Av. Faria Lima — diagonal NW→SE */}
        <line x1="-10" y1="180" x2="380" y2="280" strokeWidth="9"/>
        {/* Av. Rebouças — diagonal too */}
        <line x1="380" y1="50"  x2="-10" y2="240" strokeWidth="7"/>
        {/* Av. dos Bandeirantes — horizontal lower */}
        <line x1="-10" y1="460" x2="380" y2="460" strokeWidth="8"/>
        {/* Av. Ibirapuera — vertical right area */}
        <line x1="200" y1="-10" x2="200" y2="730" strokeWidth="6"/>
        {/* Marginal — far left vertical */}
        <line x1="14"  y1="-10" x2="14"  y2="730" strokeWidth="6"/>
      </g>
      {/* Avenue outlines (subtle grey) */}
      <g stroke="#D8D0BC" strokeLinecap="square" fill="none" opacity="0.6">
        <line x1="-10" y1="180" x2="380" y2="280" strokeWidth="11"/>
        <line x1="380" y1="50"  x2="-10" y2="240" strokeWidth="9"/>
        <line x1="-10" y1="460" x2="380" y2="460" strokeWidth="10"/>
        <line x1="200" y1="-10" x2="200" y2="730" strokeWidth="8"/>
      </g>
      {/* Then redraw the white centerlines on top so they sit cleanly */}
      <g stroke="#FFFFFF" strokeLinecap="square" fill="none">
        <line x1="-10" y1="180" x2="380" y2="280" strokeWidth="9"/>
        <line x1="380" y1="50"  x2="-10" y2="240" strokeWidth="7"/>
        <line x1="-10" y1="460" x2="380" y2="460" strokeWidth="8"/>
        <line x1="200" y1="-10" x2="200" y2="730" strokeWidth="6"/>
        <line x1="14"  y1="-10" x2="14"  y2="730" strokeWidth="6"/>
      </g>

      {/* Secondary streets — thinner */}
      <g stroke="#FFFFFF" strokeWidth="3.5" fill="none" strokeLinecap="square">
        <line x1="0" y1="40"  x2="360" y2="40"/>
        <line x1="0" y1="115" x2="360" y2="115"/>
        <line x1="0" y1="275" x2="360" y2="275"/>
        <line x1="0" y1="360" x2="360" y2="360"/>
        <line x1="0" y1="555" x2="360" y2="555"/>
        <line x1="0" y1="650" x2="360" y2="650"/>
        <line x1="115" y1="0" x2="115" y2="720"/>
        <line x1="245" y1="0" x2="245" y2="720"/>
        {/* short diagonal cross streets */}
        <line x1="125" y1="180" x2="220" y2="290"/>
        <line x1="55"  y1="40"  x2="160" y2="180"/>
      </g>

      {/* Tertiary streets — very thin */}
      <g stroke="#FFFFFF" strokeWidth="1.8" fill="none" strokeLinecap="square">
        <line x1="0" y1="75"  x2="360" y2="75"/>
        <line x1="0" y1="155" x2="360" y2="155"/>
        <line x1="0" y1="225" x2="360" y2="225"/>
        <line x1="0" y1="320" x2="360" y2="320"/>
        <line x1="0" y1="400" x2="360" y2="400"/>
        <line x1="0" y1="510" x2="360" y2="510"/>
        <line x1="0" y1="605" x2="360" y2="605"/>
        <line x1="55"  y1="0" x2="55"  y2="720"/>
        <line x1="85"  y1="0" x2="85"  y2="720"/>
        <line x1="155" y1="0" x2="155" y2="720"/>
        <line x1="180" y1="0" x2="180" y2="720"/>
        <line x1="270" y1="0" x2="270" y2="720"/>
        <line x1="305" y1="0" x2="305" y2="720"/>
        <line x1="335" y1="0" x2="335" y2="720"/>
      </g>
    </svg>
  );
}

function MapScreen({ onNav, showBanner = true }) {
  return (
    <div className="ra">
      {/* status bar pad */}
      <div style={{ height: 52 }}></div>

      {/* Map fills the screen */}
      <div className="ra-map">
        <MapStyledSvg />

        {/* Neighborhood labels */}
        <span className="ra-map-label" style={{ top: 175, left: 28 }}>VILA MADALENA</span>
        <span className="ra-map-label" style={{ top: 232, left: 226 }}>JD. EUROPA</span>
        <span className="ra-map-label" style={{ top: 318, left: 244, color: 'rgba(50,80,40,0.5)' }}>IBIRAPUERA</span>
        <span className="ra-map-label" style={{ top: 430, left: 38 }}>PINHEIROS</span>
        <span className="ra-map-label" style={{ top: 575, left: 130 }}>VILA OLÍMPIA</span>
        <span className="ra-map-label" style={{ top: 590, left: 256 }}>MOEMA</span>

        {/* Street-name labels (smaller) */}
        <span className="ra-street-label" style={{ top: 252, left: 130, transform: 'rotate(-12deg)' }}>Av. Faria Lima</span>
        <span className="ra-street-label" style={{ top: 154, left: 70, transform: 'rotate(-22deg)' }}>Av. Rebouças</span>
        <span className="ra-street-label" style={{ top: 465, left: 235 }}>Av. dos Bandeirantes</span>

        {/* Battery station pins */}
        <div className="ra-pin" style={{ top: 168, left: 215 }}>
          <Icon name="battery-full" /><span>12</span>
        </div>
        <div className="ra-pin" style={{ top: 250, right: 26 }}>
          <Icon name="battery-full" /><span>5</span>
        </div>
        <div className="ra-pin" style={{ top: 388, left: 56 }}>
          <Icon name="battery-full" /><span>7</span>
        </div>
        <div className="ra-pin" style={{ top: 462, left: 152 }}>
          <Icon name="battery-full" /><span>4</span>
        </div>
        <div className="ra-pin grey" style={{ top: 528, right: 38 }}>
          <Icon name="battery" /><span>0</span>
        </div>
        <div className="ra-pin" style={{ top: 610, left: 70 }}>
          <Icon name="battery-full" /><span>9</span>
        </div>

        {/* User location dot */}
        <div style={{
          position: 'absolute', top: 396, left: 170,
          width: 18, height: 18, borderRadius: '50%',
          background: '#2EC2FF',
          boxShadow: '0 0 0 4px rgba(46,194,255,0.3), 0 0 0 10px rgba(46,194,255,0.12), 0 1px 3px rgba(0,0,0,0.25)'
        }}></div>
      </div>

      {/* In-app banner */}
      {showBanner && (
        <div className="ra-banner">
          <div className="ico"><Icon name="wrench" /></div>
          <div className="body">
            <div className="t1">Nova cobrança de manutenção</div>
            <div className="t2">Acesse sua cobrança e confira as opções de parcelamento.</div>
          </div>
          <div className="cta">Acessar</div>
        </div>
      )}

      {/* Trocar bateria CTA */}
      <div className="ra-fab" onClick={() => onNav && onNav('reservation')}>
        <Icon name="battery-charging" />
        Trocar bateria
      </div>

      <TabBar active="home" onSelect={onNav} />
    </div>
  );
}

Object.assign(window, { MapScreen, MapStyledSvg });
