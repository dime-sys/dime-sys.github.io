import React, { useState } from 'react';

const API = "/api";

const ProjectSetupWizard = ({ onSetupComplete, onCancel }) => {
  const [step, setStep] = useState(1);
  const [numLevels, setNumLevels] = useState(3);
  const [levels, setLevels] = useState([
    { name: 'Compañía', allowFiles: false },
    { name: 'Departamento', allowFiles: false },
    { name: 'Proyecto', allowFiles: true }
  ]);
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Actualizar número de niveles
  const handleNumLevelsChange = (value) => {
    const num = parseInt(value);
    if (num >= 1 && num <= 10) {
      setNumLevels(num);
      
      // Regenerar array de niveles
      const newLevels = [];
      const defaultNames = ['Nivel 1', 'Nivel 2', 'Nivel 3', 'Nivel 4', 'Nivel 5', 'Nivel 6', 'Nivel 7', 'Nivel 8', 'Nivel 9', 'Nivel 10'];
      
      for (let i = 0; i < num; i++) {
        newLevels.push({
          name: levels[i]?.name || defaultNames[i],
          allowFiles: i === num - 1 // Solo el último nivel permite archivos por defecto
        });
      }
      setLevels(newLevels);
    }
  };

  // Actualizar nombre de un nivel
  const handleLevelNameChange = (index, newName) => {
    const newLevels = [...levels];
    newLevels[index].name = newName;
    setLevels(newLevels);
  };

  // Actualizar si un nivel permite archivos
  const handleAllowFilesChange = (index) => {
    const newLevels = [...levels];
    newLevels[index].allowFiles = !newLevels[index].allowFiles;
    setLevels(newLevels);
  };

  // Validar nombres no duplicados y no vacíos
  const validateLevels = () => {
    const names = levels.map(l => l.name.trim());
    
    for (let name of names) {
      if (!name) {
        setError('Todos los niveles deben tener un nombre');
        return false;
      }
    }
    
    const uniqueNames = new Set(names);
    if (uniqueNames.size !== names.length) {
      setError('Los nombres de los niveles deben ser únicos');
      return false;
    }
    
    setError('');
    return true;
  };

  // Crear proyecto y configuración
  const handleCreateProject = async () => {
    if (!projectName.trim()) {
      setError('El nombre del proyecto es requerido');
      return;
    }

    if (!validateLevels()) {
      return;
    }

    setLoading(true);
    try {
      // 1. Guardar configuración de niveles
      const configResponse = await fetch(`${API}/config/project-levels`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          max_levels: numLevels,
          level_names: levels.map(l => l.name),
          level_allow_files: levels.map(l => l.allowFiles)
        })
      });

      const configData = await configResponse.json();
      if (configData.status !== 'success') {
        setError('Error al guardar la configuración');
        setLoading(false);
        return;
      }

      // 2. Crear proyecto inicial
      const projectResponse = await fetch(`${API}/projects/?name=${encodeURIComponent(projectName)}`, {
        method: 'POST'
      });

      const projectData = await projectResponse.json();
      if (projectData.status !== 'success') {
        setError(projectData?.detail || 'Error al crear el proyecto');
        setLoading(false);
        return;
      }

      // Configuración completada exitosamente
      setLoading(false);
      onSetupComplete({
        config: configData,
        project: projectData.project
      });

    } catch (err) {
      console.error('Error:', err);
      setError('Error al completar la configuración');
      setLoading(false);
    }
  };

  return (
    <div className="wizard-overlay">
      <div className="wizard-container">
        <h2>Crear Nueva Estructura de Proyecto</h2>
        
        {/* Paso 1: Número de niveles */}
        {step === 1 && (
          <div className="wizard-step">
            <div className="step-content">
              <h3>Paso 1: ¿Cuántos niveles tendrá tu estructura?</h3>
              <p className="step-description">Define cuántos niveles jerárquicos necesitas (1-10)</p>
              
              <div className="form-group">
                <label>Número de niveles:</label>
                <div className="level-selector">
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={numLevels}
                    onChange={(e) => handleNumLevelsChange(e.target.value)}
                    className="slider"
                  />
                  <span className="level-value">{numLevels} niveles</span>
                </div>
              </div>

              <div className="preview">
                <p className="preview-label">Preview:</p>
                <div className="level-preview">
                  {Array.from({ length: numLevels }).map((_, i) => (
                    <div key={i} className="preview-item" style={{ marginLeft: `${i * 20}px` }}>
                      <span className="preview-level">Nivel {i + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="wizard-buttons">
              <button onClick={onCancel} className="wizard-btn-secondary">Cancelar</button>
              <button onClick={() => { setError(''); setStep(2); }} className="wizard-btn-primary">
                Siguiente <span aria-hidden="true">›</span>
              </button>
            </div>
          </div>
        )}

        {/* Paso 2: Nombres de niveles */}
        {step === 2 && (
          <div className="wizard-step">
            <div className="step-content">
              <h3>Paso 2: Nombra cada nivel</h3>
              <p className="step-description">Define el nombre de cada nivel y si permite archivos</p>

              <div className="levels-form">
                {levels.map((level, index) => (
                  <div key={index} className="level-item">
                    <div className="level-input-group">
                      <label>Nivel {index + 1}:</label>
                      <input
                        type="text"
                        value={level.name}
                        onChange={(e) => handleLevelNameChange(index, e.target.value)}
                        placeholder={`Nombre del nivel ${index + 1}`}
                        className="level-input"
                      />
                    </div>
                    <div className="level-checkbox-group">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={level.allowFiles}
                          onChange={() => handleAllowFilesChange(index)}
                          className="checkbox-input"
                        />
                        <span>Permite archivos</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              <div className="info-box">
                <p>💡 Tip: Normalmente, solo el nivel más profundo permite archivos, pero puedes personalizar según tus necesidades.</p>
              </div>
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="wizard-buttons">
              <button onClick={() => setStep(1)} className="wizard-btn-secondary">
                <span aria-hidden="true">‹</span> Atrás
              </button>
              <button 
                onClick={() => {
                  if (validateLevels()) {
                    setError('');
                    setStep(3);
                  }
                }} 
                className="wizard-btn-primary"
              >
                Siguiente <span aria-hidden="true">›</span>
              </button>
            </div>
          </div>
        )}

        {/* Paso 3: Confirmación y nombre del proyecto */}
        {step === 3 && (
          <div className="wizard-step">
            <div className="step-content">
              <h3>Paso 3: Crear proyecto</h3>
              <p className="step-description">Revisa la configuración y crea tu proyecto</p>

              <div className="review-section">
                <div className="review-item">
                  <h4>Configuración de niveles:</h4>
                  <div className="hierarchy-tree">
                    {levels.map((level, index) => (
                      <div key={index} className="hierarchy-item" style={{ paddingLeft: `${index * 20}px` }}>
                        <span className="hierarchy-name">{level.name}</span>
                        {level.allowFiles && <span className="badge-files">📁 Permite archivos</span>}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label>Nombre del proyecto inicial:</label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Ej: Mi Empresa"
                    className="project-input"
                  />
                </div>
              </div>
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="wizard-buttons">
              <button onClick={() => setStep(2)} className="wizard-btn-secondary" disabled={loading}>
                <span aria-hidden="true">‹</span> Atrás
              </button>
              <button 
                onClick={handleCreateProject} 
                className="wizard-btn-primary wizard-btn-success"
                disabled={loading}
              >
                {loading ? 'Creando...' : (
                  <>
                    <span aria-hidden="true">✓</span> Crear Proyecto
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Indicador de paso */}
        <div className="wizard-progress">
          <div className="progress-dots">
            {[1, 2, 3].map(s => (
              <div key={s} className={`dot ${s === step ? 'active' : ''} ${s < step ? 'completed' : ''}`} />
            ))}
          </div>
          <span className="progress-text">Paso {step} de 3</span>
        </div>
      </div>

      <style>{`
        .wizard-overlay {
          position: fixed;
          inset: 0;
          background: rgba(17, 24, 39, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 16px;
          backdrop-filter: blur(2px);
        }

        .wizard-container {
          background: #ffffff;
          border-radius: 12px;
          border: 1px solid #e5e7eb;
          box-shadow: 0 20px 50px rgba(15, 23, 42, 0.18);
          max-width: 660px;
          width: 100%;
          padding: 28px;
          max-height: 92vh;
          overflow-y: auto;
        }

        .wizard-container h2 {
          margin-top: 0;
          margin-bottom: 20px;
          font-size: 18px;
          color: #111827;
        }

        .wizard-step {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .step-content {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .step-content h3 {
          margin: 0;
          font-size: 15px;
          color: #1f2937;
        }

        .step-description {
          margin: 0;
          color: #6b7280;
          font-size: 12px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-group label {
          font-weight: 600;
          color: #4b5563;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          margin: 0;
        }

        .form-group input[type="text"],
        .form-group input[type="range"] {
          padding: 8px 10px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          font-size: 12px;
          font-family: inherit;
        }

        .level-selector {
          display: flex;
          gap: 12px;
          align-items: center;
        }

        .slider {
          flex: 1;
          height: 6px;
          border-radius: 999px;
          background: #d1d5db;
          outline: none;
          -webkit-appearance: none;
        }

        .slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #374151;
          cursor: pointer;
          border: 2px solid #f9fafb;
          box-shadow: 0 1px 4px rgba(15, 23, 42, 0.25);
        }

        .slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #374151;
          cursor: pointer;
          border: 2px solid #f9fafb;
          box-shadow: 0 1px 4px rgba(15, 23, 42, 0.25);
        }

        .level-value {
          font-weight: 700;
          color: #374151;
          font-size: 12px;
          min-width: 90px;
        }

        .preview {
          background: #f9fafb;
          padding: 12px;
          border-radius: 10px;
          border: 1px solid #e5e7eb;
        }

        .preview-label {
          margin: 0 0 8px 0;
          font-weight: 600;
          color: #6b7280;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .level-preview {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .preview-item {
          padding: 6px 10px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          font-size: 12px;
        }

        .preview-level {
          color: #4b5563;
        }

        .levels-form {
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-height: 320px;
          overflow-y: auto;
          padding-right: 4px;
        }

        .level-item {
          display: flex;
          gap: 12px;
          align-items: flex-end;
          padding: 10px;
          background: #f9fafb;
          border-radius: 10px;
          border: 1px solid #e5e7eb;
        }

        .level-input-group {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .level-input-group label {
          font-weight: 600;
          color: #4b5563;
          font-size: 11px;
          margin: 0;
        }

        .level-input {
          padding: 8px 10px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          font-size: 12px;
        }

        .level-checkbox-group {
          display: flex;
          align-items: center;
          min-height: 34px;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          user-select: none;
          font-size: 12px;
          color: #374151;
        }

        .checkbox-input {
          width: 16px;
          height: 16px;
          cursor: pointer;
        }

        .info-box {
          background: #f3f4f6;
          border-left: 3px solid #9ca3af;
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 11px;
          color: #4b5563;
        }

        .info-box p {
          margin: 0;
        }

        .review-section {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .review-item {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .review-item h4 {
          margin: 0;
          color: #374151;
          font-size: 12px;
          font-weight: 700;
        }

        .hierarchy-tree {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 10px;
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
        }

        .hierarchy-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          font-size: 12px;
        }

        .hierarchy-name {
          font-weight: 600;
          color: #1f2937;
        }

        .badge-files {
          display: inline-block;
          padding: 2px 8px;
          background: #f3f4f6;
          color: #374151;
          border: 1px solid #d1d5db;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 600;
        }

        .project-input {
          padding: 8px 10px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          font-size: 12px;
        }

        .error-message {
          padding: 10px 12px;
          background: #fef2f2;
          color: #b91c1c;
          border-radius: 8px;
          font-size: 12px;
          border: 1px solid #fecaca;
        }

        .wizard-buttons {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          margin-top: 12px;
        }

        .wizard-btn-primary,
        .wizard-btn-secondary {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          border: 1px solid transparent;
        }

        .wizard-btn-primary {
          background: #111827;
          color: #ffffff;
        }

        .wizard-btn-primary:hover:not(:disabled) {
          background: #1f2937;
        }

        .wizard-btn-success {
          background: #0f172a;
        }

        .wizard-btn-secondary {
          background: #f3f4f6;
          color: #374151;
          border-color: #d1d5db;
        }

        .wizard-btn-secondary:hover:not(:disabled) {
          background: #e5e7eb;
        }

        .wizard-btn-primary:disabled,
        .wizard-btn-secondary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .wizard-progress {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          margin-top: 20px;
          padding-top: 14px;
          border-top: 1px solid #e5e7eb;
        }

        .progress-dots {
          display: flex;
          gap: 6px;
        }

        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #d1d5db;
          transition: all 0.3s;
        }

        .dot.active {
          background: #111827;
          transform: scale(1.15);
        }

        .dot.completed {
          background: #4b5563;
        }

        .progress-text {
          font-size: 11px;
          color: #6b7280;
        }

        @media (max-width: 600px) {
          .wizard-container {
            padding: 18px;
          }

          .level-item {
            flex-direction: column;
            align-items: stretch;
          }

          .wizard-buttons {
            flex-direction: column;
          }

          .wizard-btn-primary,
          .wizard-btn-secondary {
            width: 100%;
            justify-content: center;
          }
        }
      `}</style>
    </div>
  );
};

export default ProjectSetupWizard;
