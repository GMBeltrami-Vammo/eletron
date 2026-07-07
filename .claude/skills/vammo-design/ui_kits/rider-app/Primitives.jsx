// Rider App — primitives (Icon, NavBar, TabBar, BottomSheet)

function Icon({ name, size }) {
  return <i data-lucide={name} style={size ? { width: size, height: size } : undefined}></i>;
}

function NavBar({ title, onBack, right }) {
  return (
    <div className="ra-navbar">
      <div className="back" onClick={onBack}>{onBack && <Icon name="arrow-left" />}</div>
      <div className="title">{title}</div>
      <div className="right">{right}</div>
    </div>
  );
}

function TabBar({ active, onSelect }) {
  return (
    <div className="ra-tabbar">
      <div className={'ra-tab' + (active === 'home' ? ' active' : '')} onClick={() => onSelect && onSelect('home')}>
        <Icon name="house" />
      </div>
      <div className={'ra-tab' + (active === 'profile' ? ' active' : '')} onClick={() => onSelect && onSelect('profile')}>
        <Icon name="user-round" />
      </div>
    </div>
  );
}

function BottomSheet({ icon, title, onClose, children }) {
  return (
    <div className="ra-sheet-bg" onClick={onClose}>
      <div className="ra-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="head">
          {icon && <span className="icon"><Icon name={icon} /></span>}
          <span className="h">{title}</span>
          <span className="close" onClick={onClose}><Icon name="x" /></span>
        </div>
        {children}
      </div>
    </div>
  );
}

Object.assign(window, { Icon, NavBar, TabBar, BottomSheet });
