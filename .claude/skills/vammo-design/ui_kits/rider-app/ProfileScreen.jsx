// ProfileScreen — supports two states from the Figma:
//  · "withoutBike": Moto não cadastrada
//  · "withBike":    RFT-5768 NIU Sport + Reserva tag + "Ver documento" + Pagamentos / Multas / Indique / Configurações / Suporte

function ProfileScreen({ onNav, state = 'withBike' }) {
  const withoutBike = state === 'withoutBike';
  return (
    <div className="ra ra-with-navbar">
      <div className="ra-scroll">
        <div className="ra-profile-card">
          <div className="title">Perfil</div>
          <div className="name-row">
            <Icon name="user-round" />
            <span>Marcos da Silva</span>
          </div>
          <div className="stats">
            <div className="ra-stat">
              <span className="lbl">Trocas feitas</span>
              <span className="num">{withoutBike ? '134' : '283'}</span>
              <span className="unit">baterias</span>
            </div>
            <div className="ra-stat">
              <span className="lbl">Tempo na vammo</span>
              <span className="num">{withoutBike ? '3' : '78'}</span>
              <span className="unit">{withoutBike ? 'meses' : 'dias'}</span>
            </div>
          </div>
        </div>

        <div className="ra-section-title">Minha moto</div>
        {withoutBike ? (
          <div className="ra-bike-card">
            <div className="ico"><Icon name="bike" /></div>
            <div className="body">
              <div className="t1">Moto não cadastrada</div>
              <div className="t2">Contate o suporte para ajuda</div>
            </div>
          </div>
        ) : (
          <>
            <div className="ra-bike-card">
              <div className="ico"><Icon name="bike" /></div>
              <div className="body">
                <div className="t1">SCY1H73</div>
                <div className="t2">Vmoto CPX</div>
              </div>
            </div>
            <button className="ra-btn-outline">
              <Icon name="file-text" />
              Documento
            </button>
          </>
        )}

        <div className="ra-rows">
          <div className="ra-row">
            <div className="ico"><Icon name="wallet" /></div>
            <div className="lbl">Pagamentos</div>
            <div className="right"><Icon name="chevron-right" /></div>
          </div>
          {!withoutBike && (
            <div className="ra-row">
              <div className="ico"><Icon name="file-warning" /></div>
              <div className="lbl">Multas</div>
              <div className="right"><Icon name="chevron-right" /></div>
            </div>
          )}
          {!withoutBike && (
            <div className="ra-row">
              <div className="ico"><Icon name="gift" /></div>
              <div className="lbl" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Indique e ganhe <span className="new-tag">NOVO</span></div>
              <div className="right"><Icon name="chevron-right" /></div>
            </div>
          )}
          <div className="ra-row">
            <div className="ico"><Icon name="settings" /></div>
            <div className="lbl">Configurações</div>
            <div className="right"><Icon name="chevron-right" /></div>
          </div>
          <div className="ra-row">
            <div className="ico"><Icon name="message-circle" /></div>
            <div className="lbl">{withoutBike ? 'Entrar em contato' : 'Preciso de suporte'}</div>
            <div className="right"><Icon name="external-link" /></div>
          </div>
        </div>
      </div>
      <TabBar active="profile" onSelect={onNav} />
    </div>
  );
}

Object.assign(window, { ProfileScreen });
