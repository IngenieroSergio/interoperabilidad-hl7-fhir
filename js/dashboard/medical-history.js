document.addEventListener('DOMContentLoaded', function() {
    // Verificar autenticación
    const userData = JSON.parse(sessionStorage.getItem('currentMediConnectUser'));
    if (!userData) {
        window.location.href = '../auth/login.html';
        return;
    }

    // Configuración FHIR
    const FHIR_SERVER = 'http://localhost:8080/fhir';
    const PRACTITIONER_ID = userData.id;
    let currentPatient = null;
    let encounters = [];

    // Elementos del DOM
    const patientSelect = document.getElementById('patient-select');
    const newRecordBtn = document.getElementById('new-record-btn');
    const patientSummary = document.getElementById('patient-summary');
    const medicalRecords = document.getElementById('medical-records');

    // Inicializar
    loadPatients();
    setupEventListeners();

    // Cargar lista de pacientes - Versión basada en patients.js
    async function loadPatients() {
        try {
            showLoadingState();
            let patients = [];
            
            // Estrategia 1: Buscar a través de PractitionerRole
            try {
                const rolesResponse = await fetch(
                    `${FHIR_SERVER}/PractitionerRole?practitioner=${PRACTITIONER_ID}&_count=100`,
                    { headers: { 'Accept': 'application/fhir+json' } }
                );
                
                if (rolesResponse.ok) {
                    const rolesData = await rolesResponse.json();
                    const patientIds = rolesData.entry
                        ?.map(entry => entry.resource.patient?.reference?.split('/')[1])
                        .filter(id => id) || [];
                    
                    if (patientIds.length > 0) {
                        const patientsResponse = await fetch(
                            `${FHIR_SERVER}/Patient?_id=${patientIds.join(',')}&_count=100`,
                            { headers: { 'Accept': 'application/fhir+json' } }
                        );
                        
                        if (patientsResponse.ok) {
                            const patientsData = await patientsResponse.json();
                            patients = patientsData.entry?.map(entry => entry.resource) || [];
                        }
                    }
                }
            } catch (e) {
                console.log('Búsqueda por PractitionerRole falló, intentando método alternativo...', e);
            }
            
            // Estrategia 2: Si no hay resultados, buscar todos los pacientes
            if (patients.length === 0) {
                const allPatientsResponse = await fetch(
                    `${FHIR_SERVER}/Patient?_count=100`,
                    { headers: { 'Accept': 'application/fhir+json' } }
                );
                
                if (allPatientsResponse.ok) {
                    const allPatientsData = await allPatientsResponse.json();
                    patients = allPatientsData.entry?.map(entry => entry.resource) || [];
                }
            }
            
            updatePatientSelect(patients);
            
            if (patients.length === 0) {
                showInfo('No se encontraron pacientes. Registre nuevos pacientes para comenzar.');
            }
            
        } catch (error) {
            console.error('Error cargando pacientes:', error);
            showError('Error al cargar la lista de pacientes: ' + error.message);
        }
    }

    // Actualizar selector de pacientes
    function updatePatientSelect(patients) {
        patientSelect.innerHTML = '<option value="">Seleccionar paciente...</option>';
        
        patients.forEach(patient => {
            const name = getPatientName(patient);
            const identifier = patient.identifier?.[0]?.value || 'Sin ID';
            
            const option = document.createElement('option');
            option.value = patient.id;
            option.textContent = `${name} (${identifier})`;
            option.setAttribute('data-patient-id', patient.id);
            patientSelect.appendChild(option);
        });
    }

    // Configurar event listeners
    function setupEventListeners() {
        // Selección de paciente
        patientSelect.addEventListener('change', async (e) => {
            const selectedOption = e.target.options[e.target.selectedIndex];
            const patientId = selectedOption.dataset.patientId;
            
            if (patientId) {
                newRecordBtn.disabled = false;
                await loadPatientData(patientId);
            } else {
                newRecordBtn.disabled = true;
                clearPatientData();
            }
        });
        
        // Nuevo registro
        newRecordBtn.addEventListener('click', () => {
            if (currentPatient) openNewRecordModal();
        });
    }

    // Cargar datos del paciente seleccionado
    async function loadPatientData(patientId) {
        try {
            showLoadingState();
            
            // Obtener información del paciente
            const patientResponse = await fetch(
                `${FHIR_SERVER}/Patient/${patientId}`,
                { headers: { 'Accept': 'application/fhir+json' } }
            );
            
            if (!patientResponse.ok) throw new Error('Error al cargar paciente');
            
            currentPatient = await patientResponse.json();
            updatePatientSummary(currentPatient);
            
            // Obtener encuentros (consultas) del paciente
            const encountersResponse = await fetch(
                `${FHIR_SERVER}/Encounter?patient=${patientId}&_sort=-date&_count=100`,
                { headers: { 'Accept': 'application/fhir+json' } }
            );
            
            if (!encountersResponse.ok) throw new Error('Error al cargar historial');
            
            const encountersData = await encountersResponse.json();
            encounters = encountersData.entry?.map(entry => entry.resource) || [];
            
            // Para cada encuentro, obtener diagnósticos, observaciones, etc.
            const fullRecords = [];
            for (const encounter of encounters) {
                const record = await buildFullRecord(encounter);
                fullRecords.push(record);
            }
            
            updateMedicalRecords(fullRecords);
            
        } catch (error) {
            console.error('Error cargando datos del paciente:', error);
            showError('Error al cargar datos del paciente: ' + error.message);
        }
    }

    // Construir registro completo con información relacionada
    async function buildFullRecord(encounter) {
        const record = {
            encounter: encounter,
            conditions: [],
            observations: [],
            medications: []
        };
        
        // Obtener diagnósticos (Conditions)
        try {
            const conditionsResponse = await fetch(
                `${FHIR_SERVER}/Condition?encounter=${encounter.id}`,
                { headers: { 'Accept': 'application/fhir+json' } }
            );
            
            if (conditionsResponse.ok) {
                const conditionsData = await conditionsResponse.json();
                record.conditions = conditionsData.entry?.map(entry => entry.resource) || [];
            }
        } catch (e) {
            console.error("Error cargando condiciones:", e);
        }
        
        // Obtener observaciones (Observations)
        try {
            const observationsResponse = await fetch(
                `${FHIR_SERVER}/Observation?encounter=${encounter.id}`,
                { headers: { 'Accept': 'application/fhir+json' } }
            );
            
            if (observationsResponse.ok) {
                const observationsData = await observationsResponse.json();
                record.observations = observationsData.entry?.map(entry => entry.resource) || [];
            }
        } catch (e) {
            console.error("Error cargando observaciones:", e);
        }
        
        // Obtener medicaciones (MedicationRequests)
        try {
            const medicationsResponse = await fetch(
                `${FHIR_SERVER}/MedicationRequest?encounter=${encounter.id}`,
                { headers: { 'Accept': 'application/fhir+json' } }
            );
            
            if (medicationsResponse.ok) {
                const medicationsData = await medicationsResponse.json();
                record.medications = medicationsData.entry?.map(entry => entry.resource) || [];
            }
        } catch (e) {
            console.error("Error cargando medicaciones:", e);
        }
        
        return record;
    }

    // Actualizar resumen del paciente
    function updatePatientSummary(patient) {
        const name = getPatientName(patient);
        const gender = getGenderDisplay(patient.gender);
        const birthDate = patient.birthDate ? formatDate(patient.birthDate) : 'N/A';
        const age = patient.birthDate ? calculateAge(patient.birthDate) : 'N/A';
        const identifier = patient.identifier?.[0]?.value || 'N/A';
        
        patientSummary.innerHTML = `
            <div class="patient-summary-content">
                <div class="patient-avatar-large">${getInitials(name)}</div>
                <div class="patient-info-summary">
                    <h2>${name}</h2>
                    <div class="patient-meta-summary">
                        <span>${gender}, ${age} años</span>
                        <span>Nacimiento: ${birthDate}</span>
                        <span>ID: ${identifier}</span>
                    </div>
                    <div class="patient-stats">
                        <div class="stat-item">
                            <div class="stat-value">${encounters.length}</div>
                            <div class="stat-label">Consultas</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${
                                encounters.flatMap(e => e.conditions).length
                            }</div>
                            <div class="stat-label">Diagnósticos</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${
                                encounters.flatMap(e => e.medications).length
                            }</div>
                            <div class="stat-label">Tratamientos</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // Actualizar lista de registros médicos
    function updateMedicalRecords(records) {
        if (records.length === 0) {
            medicalRecords.innerHTML = `
                <div class="empty-state">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                    <p>No hay registros clínicos para mostrar</p>
                </div>
            `;
            return;
        }
        
        medicalRecords.innerHTML = records.map(record => {
            const encounter = record.encounter;
            const date = encounter.period?.start ? formatDateTime(encounter.period.start) : 'Fecha desconocida';
            const type = getEncounterTypeDisplay(encounter.class?.code);
            
            // Obtener texto de vista previa
            let previewText = '';
            if (record.conditions.length > 0) {
                previewText = record.conditions[0].code?.text || 'Diagnóstico registrado';
            } else if (record.observations.length > 0) {
                previewText = record.observations[0].code?.text || 'Observación registrada';
            } else if (record.medications.length > 0) {
                previewText = record.medications[0].medicationCodeableConcept?.text || 'Tratamiento registrado';
            } else {
                previewText = 'Consulta sin detalles registrados';
            }
            
            return `
                <div class="record-item" data-encounter-id="${encounter.id}">
                    <div class="record-header">
                        <span class="record-type">${type}</span>
                        <span class="record-date">${date}</span>
                    </div>
                    <div class="record-preview">${previewText}</div>
                </div>
            `;
        }).join('');
        
        // Agregar event listeners a los registros
        document.querySelectorAll('.record-item').forEach(item => {
            item.addEventListener('click', () => {
                const encounterId = item.dataset.encounterId;
                const record = records.find(r => r.encounter.id === encounterId);
                showRecordDetails(record);
            });
        });
    }

    // Mostrar estado de carga
    function showLoadingState() {
        medicalRecords.innerHTML = `
            <div class="loading-state">
                <div class="loading-spinner"></div>
                <p>Cargando datos...</p>
            </div>
        `;
    }

    // Funciones auxiliares
    function getPatientName(patient) {
        if (!patient) return 'Nombre no disponible';
        
        if (patient.name?.[0]?.text) {
            return patient.name[0].text;
        }
        
        const givenName = patient.name?.[0]?.given?.join(' ') || '';
        const familyName = patient.name?.[0]?.family || '';
        return `${givenName} ${familyName}`.trim() || 'Nombre no disponible';
    }

    function getInitials(name) {
        return name.split(' ').map(part => part[0]).join('').substring(0, 2).toUpperCase();
    }

    function getGenderDisplay(gender) {
        const genderMap = {
            'male': 'Masculino',
            'female': 'Femenino',
            'other': 'Otro',
            'unknown': 'Desconocido'
        };
        return genderMap[gender] || gender;
    }

    function calculateAge(birthDate) {
        if (!birthDate) return 'N/A';
        
        const birth = new Date(birthDate);
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const monthDiff = today.getMonth() - birth.getMonth();
        
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
            age--;
        }
        
        return age;
    }

    function formatDate(dateString) {
        if (!dateString) return 'N/A';
        
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        return new Date(dateString).toLocaleDateString('es-ES', options);
    }

    function formatDateTime(dateTimeString) {
        if (!dateTimeString) return 'Fecha desconocida';
        
        const options = { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        };
        return new Date(dateTimeString).toLocaleDateString('es-ES', options);
    }

    function getEncounterTypeDisplay(code) {
        const typeMap = {
            'AMB': 'Consulta ambulatoria',
            'EMER': 'Urgencias',
            'IMP': 'Hospitalización',
            'HH': 'Atención domiciliaria',
            'VR': 'Consulta virtual'
        };
        return typeMap[code] || 'Consulta médica';
    }

    function showInfo(message) {
        medicalRecords.innerHTML = `
            <div class="info-state">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3498db" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                <p>${message}</p>
            </div>
        `;
    }

    function showError(message) {
        medicalRecords.innerHTML = `
            <div class="error-state">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <p>${message}</p>
            </div>
        `;
    }

    function clearPatientData() {
        currentPatient = null;
        encounters = [];
        
        patientSummary.innerHTML = `
            <div class="empty-state">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                </svg>
                <p>Seleccione un paciente para ver su historial clínico</p>
            </div>
        `;
    }

    // Funciones para modales (simplificadas)
    // Función para abrir modal de nuevo registro (completa)
function openNewRecordModal() {
    const modal = document.getElementById('new-record-modal');
    const form = document.getElementById('record-form');
    
    // Resetear formulario
    form.reset();
    document.querySelectorAll('.record-section').forEach(section => {
        section.style.display = 'none';
    });
    
    // Establecer fecha/hora actual por defecto
    const now = new Date();
    const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    document.getElementById('record-date').value = localDateTime;
    
    // Configurar evento para cambiar campos según tipo de registro
    document.getElementById('record-type').addEventListener('change', function() {
        const type = this.value;
        document.querySelectorAll('.record-section').forEach(section => {
            section.style.display = 'none';
        });
        
        if (type === 'diagnosis') {
            document.getElementById('diagnosis-fields').style.display = 'block';
        } else if (type === 'treatment') {
            document.getElementById('treatment-fields').style.display = 'block';
        } else if (type === 'observation') {
            document.getElementById('observation-fields').style.display = 'block';
        }
    });
    
    // Mostrar modal
    modal.style.display = 'flex';
    
    // Manejar cierre del modal
    document.querySelector('#new-record-modal .close-modal').onclick = () => {
        modal.style.display = 'none';
    };
    
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    };
}

// Función para guardar nuevo registro médico (completa)
async function saveMedicalRecord() {
    const form = document.getElementById('record-form');
    const recordType = document.getElementById('record-type').value;
    const recordDate = document.getElementById('record-date').value;
    const notes = document.getElementById('record-notes').value;
    
    if (!currentPatient || !recordType || !recordDate) {
        showError('Complete todos los campos requeridos');
        return;
    }
    
    try {
        showLoadingState();
        
        // 1. Crear recurso Encounter (consulta)
        const encounter = await createEncounter(recordDate);
        
        // 2. Crear recursos según el tipo de registro
        if (recordType === 'diagnosis') {
            await createDiagnosis(encounter);
        } else if (recordType === 'treatment') {
            await createTreatment(encounter);
        } else if (recordType === 'observation') {
            await createObservation(encounter);
        }
        
        // 3. Agregar notas generales si existen
        if (notes) {
            await updateEncounterWithNotes(encounter, notes);
        }
        
        // 4. Actualizar lista de registros
        const newRecord = await buildFullRecord(encounter);
        encounters.unshift(newRecord);
        updateMedicalRecords(encounters);
        updatePatientSummary(currentPatient);
        
        // 5. Cerrar modal y mostrar éxito
        document.getElementById('new-record-modal').style.display = 'none';
        showSuccess('Registro clínico guardado exitosamente');
        
    } catch (error) {
        console.error('Error guardando registro:', error);
        showError('Error al guardar el registro clínico: ' + error.message);
    }
}

// Función para crear un Encounter en FHIR
async function createEncounter(dateTime) {
    const encounterData = {
        resourceType: "Encounter",
        status: "finished",
        class: {
            system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
            code: "AMB",
            display: "ambulatory"
        },
        subject: {
            reference: `Patient/${currentPatient.id}`
        },
        participant: [{
            individual: {
                reference: `Practitioner/${PRACTITIONER_ID}`
            }
        }],
        period: {
            start: dateTime,
            end: dateTime
        },
        serviceProvider: {
            reference: "Organization/1"
        }
    };
    
    const response = await fetch(`${FHIR_SERVER}/Encounter`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/fhir+json',
            'Accept': 'application/fhir+json'
        },
        body: JSON.stringify(encounterData)
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.issue?.[0]?.details?.text || 'Error al crear consulta');
    }
    
    return await response.json();
}

// Función para crear un Diagnosis (Condition) en FHIR
async function createDiagnosis(encounter) {
    const code = document.getElementById('diagnosis-code').value;
    const description = document.getElementById('diagnosis-description').value;
    const severity = document.getElementById('diagnosis-severity').value;
    
    const conditionData = {
        resourceType: "Condition",
        clinicalStatus: {
            coding: [{
                system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
                code: "active"
            }]
        },
        verificationStatus: {
            coding: [{
                system: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
                code: "confirmed"
            }]
        },
        code: {
            coding: [{
                system: "http://hl7.org/fhir/sid/icd-10",
                code: code || "UNKNOWN",
                display: description || "Diagnóstico sin especificar"
            }],
            text: description || 'Diagnóstico registrado'
        },
        subject: {
            reference: `Patient/${currentPatient.id}`
        },
        encounter: {
            reference: `Encounter/${encounter.id}`
        },
        recordedDate: new Date().toISOString(),
        severity: {
            coding: [{
                system: "http://snomed.info/sct",
                code: severity === 'mild' ? "255604002" : 
                      severity === 'moderate' ? "6736007" : "24484000",
                display: severity === 'mild' ? "Leve" : 
                        severity === 'moderate' ? "Moderado" : "Severo"
            }]
        }
    };
    
    const response = await fetch(`${FHIR_SERVER}/Condition`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/fhir+json',
            'Accept': 'application/fhir+json'
        },
        body: JSON.stringify(conditionData)
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.issue?.[0]?.details?.text || 'Error al crear diagnóstico');
    }
    
    return await response.json();
}

// Función para crear un Treatment (MedicationRequest) en FHIR
async function createTreatment(encounter) {
    const medication = document.getElementById('treatment-medication').value;
    const dosage = document.getElementById('treatment-dosage').value;
    const frequency = document.getElementById('treatment-frequency').value;
    const duration = document.getElementById('treatment-duration').value;
    
    const medicationData = {
        resourceType: "MedicationRequest",
        status: "active",
        intent: "order",
        medicationCodeableConcept: {
            text: medication || 'Medicamento no especificado'
        },
        subject: {
            reference: `Patient/${currentPatient.id}`
        },
        encounter: {
            reference: `Encounter/${encounter.id}`
        },
        authoredOn: new Date().toISOString(),
        requester: {
            reference: `Practitioner/${PRACTITIONER_ID}`
        },
        dosageInstruction: [{
            text: `${dosage || '1'} ${frequency || 'cada 8 horas'} durante ${duration || '7 días'}`,
            timing: {
                code: {
                    text: frequency || 'cada 8 horas'
                }
            },
            doseAndRate: [{
                doseQuantity: {
                    value: parseFloat(dosage) || 1,
                    unit: "dosis"
                }
            }]
        }]
    };
    
    const response = await fetch(`${FHIR_SERVER}/MedicationRequest`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/fhir+json',
            'Accept': 'application/fhir+json'
        },
        body: JSON.stringify(medicationData)
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.issue?.[0]?.details?.text || 'Error al crear tratamiento');
    }
    
    return await response.json();
}

// Función para crear una Observation en FHIR
async function createObservation(encounter) {
    const observationType = document.getElementById('observation-code').value;
    const value = document.getElementById('observation-value').value;
    const unit = document.getElementById('observation-unit').value;
    const observationNotes = document.getElementById('observation-notes').value;
    
    // Mapear tipos de observación a códigos LOINC
    const observationCodes = {
        'blood-pressure': {
            code: "85354-9",
            display: "Blood pressure panel"
        },
        'heart-rate': {
            code: "8867-4",
            display: "Heart rate"
        },
        'temperature': {
            code: "8310-5",
            display: "Body temperature"
        },
        'weight': {
            code: "29463-7",
            display: "Body weight"
        },
        'height': {
            code: "8302-2",
            display: "Body height"
        },
        'other': {
            code: "75321-0",
            display: "Clinical observation"
        }
    };
    
    const observationData = {
        resourceType: "Observation",
        status: "final",
        code: {
            coding: [observationCodes[observationType] || observationCodes.other],
            text: document.getElementById('observation-code').options[
                document.getElementById('observation-code').selectedIndex
            ].text
        },
        subject: {
            reference: `Patient/${currentPatient.id}`
        },
        encounter: {
            reference: `Encounter/${encounter.id}`
        },
        effectiveDateTime: new Date().toISOString(),
        valueQuantity: {
            value: parseFloat(value) || 0,
            unit: unit || '',
            system: "http://unitsofmeasure.org",
            code: unit || '{unknown}'
        }
    };
    
    if (observationNotes) {
        observationData.note = [{
            text: observationNotes
        }];
    }
    
    const response = await fetch(`${FHIR_SERVER}/Observation`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/fhir+json',
            'Accept': 'application/fhir+json'
        },
        body: JSON.stringify(observationData)
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.issue?.[0]?.details?.text || 'Error al crear observación');
    }
    
    return await response.json();
}

// Función para actualizar un Encounter con notas
async function updateEncounterWithNotes(encounter, notes) {
    const encounterUpdate = {
        resourceType: "Encounter",
        id: encounter.id,
        note: [{
            text: notes,
            time: new Date().toISOString()
        }]
    };
    
    const response = await fetch(`${FHIR_SERVER}/Encounter/${encounter.id}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/fhir+json',
            'Accept': 'application/fhir+json'
        },
        body: JSON.stringify(encounterUpdate)
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.issue?.[0]?.details?.text || 'Error al agregar notas a la consulta');
    }
    
    return await response.json();
}

// Configurar el event listener para el formulario de registro
document.getElementById('record-form').addEventListener('submit', function(e) {
    e.preventDefault();
    saveMedicalRecord();
});

    function showRecordDetails(record) {
        console.log("Mostrar detalles del registro:", record);
        // Implementación del modal de detalles aquí
    }
});