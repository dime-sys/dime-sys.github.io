import React, { useState, useEffect } from 'react';
import { Settings, Save, X } from 'lucide-react';

const ProjectLevelConfig = ({ onClose, onSave }) => {
  const [maxLevels, setMaxLevels] = useState(4);
  const [levelNames, setLevelNames] = useState(['Compañía', 'Área', 'Departamento', 'Proyecto']);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const response = await fetch('http://localhost:8000/config/project-levels');
      const data = await response.json();
      setMaxLevels(data.max_levels || 4);
      setLevelNames(data.level_names || ['Compañía', 'Área', 'Departamento', 'Proyecto']);
    } catch (error) {
      console.error('Error loading config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMaxLevelsChange = (e) => {
    const value = parseInt(e.target.value);
    if (value >= 1 && value <= 10) {
      setMaxLevels(value);
      // Adjust level names array
      if (value > levelNames.length) {
        const newNames = [...levelNames];
        for (let i = levelNames.length; i < value; i++) {
          newNames.push(`Nivel ${i + 1}`);
        }
        setLevelNames(newNames);
      } else {
        setLevelNames(levelNames.slice(0, value));
      }
    }
  };

  const handleNameChange = (index, newName) => {
    const newNames = [...levelNames];
    newNames[index] = newName;
    setLevelNames(newNames);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch('http://localhost:8000/config/project-levels', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          max_levels: maxLevels,
          level_names: levelNames
        })
      });

      const data = await response.json();
      if (data.status === 'success') {
        alert('Configuración guardada exitosamente');
        onSave?.();
        onClose();
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error('Error saving config:', error);
      alert('Error al guardar la configuración');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="config-modal-overlay"><div className="config-modal config-modal-loading">Cargando...</div></div>;
  }

  return (
    <div className="config-modal-overlay" onClick={onClose}>
      <div className="config-modal" onClick={(e) => e.stopPropagation()}>
        <div className="config-header">
          <div className="config-title">
            <Settings size={20} />
            <h2>Configurar Estructura de Proyectos</h2>
          </div>
          <button className="btn-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="config-content">
          <div className="config-section">
            <label htmlFor="maxLevels">Máximo de Niveles</label>
            <div className="config-level-input-group">
              <input
                id="maxLevels"
                type="number"
                min="1"
                max="10"
                value={maxLevels}
                onChange={handleMaxLevelsChange}
              />
              <span className="config-level-info">(entre 1 y 10)</span>
            </div>
          </div>

          <div className="config-section">
            <label>Nombres de los Niveles</label>
            <div className="config-levels-list">
              {levelNames.map((name, index) => (
                <div key={index} className="config-level-name-item">
                  <span className="config-level-number">Nivel {index + 1}</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => handleNameChange(index, e.target.value)}
                    placeholder={`Nombre para nivel ${index + 1}`}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="config-preview">
            <h4>Vista Previa</h4>
            <div className="config-preview-tree">
              {levelNames.map((name, index) => (
                <div key={index} className="config-preview-node" style={{ paddingLeft: `${index * 20}px` }}>
                  <span>└─ {name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="config-footer">
          <button className="btn-cancel" onClick={onClose}>
            Cancelar
          </button>
          <button 
            className="btn-save" 
            onClick={handleSave}
            disabled={saving}
          >
            <Save size={16} />
            {saving ? 'Guardando...' : 'Guardar Configuración'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectLevelConfig;
