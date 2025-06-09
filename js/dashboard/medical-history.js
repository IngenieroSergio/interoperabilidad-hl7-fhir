document.addEventListener('DOMContentLoaded', function() {
    // 1. Verificación de autenticación
    const userData = JSON.parse(sessionStorage.getItem('currentMediConnectUser'));
    if (!userData) {
        window.location.href = '../auth/login.html';
        return;
    }

    // 2. Configuración de servicios
    const FHIR_SERVER = 'http://localhost:8080/fhir';
    const FIREBASE_DB_URL = 'https://hapi-fhir-16ed2-default-rtdb.firebaseio.com/';
    const PRACTITIONER_ID = userData.id;
    let currentPatient = null;
    let allRecords = [];
    let allPatients = []; // Almacenaremos todos los pacientes cargados

    // 3. Inicialización de Firebase
    const firebaseConfig = {
        databaseURL: FIREBASE_DB_URL
    };
    
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    const database = firebase.database();

    // 4. Referencias a elementos del DOM
    const patientSelect = document.getElementById('patient-select');
    const newRecordBtn = document.getElementById('new-record-btn');
    const patientSummary = document.getElementById('patient-summary');
    const medicalRecords = document.getElementById('medical-records');
    const newRecordModal = document.getElementById('new-record-modal');
    const recordDetailModal = document.getElementById('record-detail-modal');
    const cancelRecordBtn = document.getElementById('cancel-record-btn');

    // 5. Inicialización de la aplicación
    initApplication();

    async function initApplication() {
        setupEventListeners();
        await loadPractitionerData();
        await loadPatients();
    }

    // 6. Cargar datos del médico
    async function loadPractitionerData() {
        try {
            // Actualizar UI con datos del médico
            document.getElementById('sidebar-doctor-name').textContent = `Dr. ${userData.name || 'Nombre'}`;
            document.getElementById('sidebar-doctor-email').textContent = userData.email;
            
            // Verificar/crear registro del médico en Firebase
            const practitionerRef = database.ref(`practitioners/${PRACTITIONER_ID}`);
            const snapshot = await practitionerRef.once('value');
            
            if (!snapshot.exists()) {
                await practitionerRef.set({
                    email: userData.email,
                    isActive: true,
                    registrationDate: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error('Error cargando datos del médico:', error);
        }
    }

    // 7. Cargar lista de pacientes
    async function loadPatients() {
        try {
            showLoadingState();
            let patients = [];
            
            // Primero intentamos cargar desde Firebase
            try {
                const snapshot = await database.ref('patient_identifiers').once('value');
                const firebasePatients = snapshot.val();
                
                if (firebasePatients) {
                    const patientIds = Object.values(firebasePatients)
                        .filter(patient => patient.practitionerId === PRACTITIONER_ID)
                        .map(patient => patient.patientId);
                    
                    if (patientIds.length > 0) {
                        // Obtener detalles de pacientes desde FHIR
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
            } catch (firebaseError) {
                console.log('Error al cargar pacientes desde Firebase:', firebaseError);
            }
            
            // Si no hay pacientes en Firebase, cargar desde FHIR
            if (patients.length === 0) {
                patients = await loadPatientsFromFHIR();
                
                // Sincronizar pacientes con Firebase
                if (patients.length > 0) {
                    await syncPatientsToFirebase(patients);
                }
            }
            
            // Almacenar todos los pacientes para referencia futura
            allPatients = patients;
            updatePatientSelect(allPatients);
            
            if (allPatients.length === 0) {
                showInfo('No se encontraron pacientes. Registre nuevos pacientes para comenzar.');
            }
            
        } catch (error) {
            console.error('Error cargando pacientes:', error);
            showError('Error al cargar la lista de pacientes: ' + error.message);
        } finally {
            if (allPatients.length === 0) {
                clearPatientData();
            }
        }
    }

    // 8. Cargar pacientes desde FHIR
    async function loadPatientsFromFHIR() {
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
            console.log('Búsqueda por PractitionerRole falló:', e);
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
        
        return patients;
    }

    // 9. Sincronizar pacientes con Firebase
    async function syncPatientsToFirebase(patients) {
        try {
            for (const patient of patients) {
                const patientId = patient.id;
                const identifier = patient.identifier?.[0]?.value;
                
                if (identifier) {
                    // Guardar relación paciente-médico en Firebase
                    await database.ref(`patient_identifiers/${identifier}`).set({
                        patientId: patientId,
                        practitionerId: PRACTITIONER_ID,
                        registrationDate: new Date().toISOString()
                    });
                    
                    // Guardar metadatos del paciente en Firebase
                    await database.ref(`patients/${patientId}/metadata`).set({
                        name: getPatientName(patient),
                        gender: patient.gender,
                        birthDate: patient.birthDate,
                        lastUpdated: new Date().toISOString()
                    });
                }
            }
        } catch (error) {
            console.error('Error sincronizando pacientes con Firebase:', error);
        }
    }

    // 10. Configurar event listeners
    function setupEventListeners() {
        // Selección de paciente
        patientSelect.addEventListener('change', async (e) => {
            const selectedOption = e.target.options[e.target.selectedIndex];
            const patientId = selectedOption.dataset.patientId;
            
            if (patientId) {
                newRecordBtn.disabled = false;
                // Buscar el paciente en la lista ya cargada
                const selectedPatient = allPatients.find(p => p.id === patientId);
                if (selectedPatient) {
                    currentPatient = selectedPatient;
                    await loadPatientData(patientId);
                } else {
                    showError('Paciente seleccionado no encontrado en la lista local');
                    clearPatientData();
                }
            } else {
                newRecordBtn.disabled = true;
                clearPatientData();
            }
        });
        
        // Resto de event listeners...
        newRecordBtn.addEventListener('click', () => {
            if (currentPatient) openNewRecordModal();
        });

        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', function() {
                newRecordModal.style.display = 'none';
                recordDetailModal.style.display = 'none';
            });
        });

        window.addEventListener('click', function(e) {
            if (e.target === newRecordModal) {
                newRecordModal.style.display = 'none';
            }
            if (e.target === recordDetailModal) {
                recordDetailModal.style.display = 'none';
            }
        });

        cancelRecordBtn.addEventListener('click', function() {
            newRecordModal.style.display = 'none';
        });

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

        document.getElementById('print-record-btn').addEventListener('click', function() {
            window.print();
        });

        document.getElementById('record-form').addEventListener('submit', function(e) {
            e.preventDefault();
            saveMedicalRecord();
        });
    }

    // 11. Cargar datos del paciente seleccionado (VERSIÓN MEJORADA)
async function loadPatientData(patientId) {
    try {
        showLoadingState();
        
        // Buscar el paciente en la lista ya cargada
        const selectedPatient = allPatients.find(p => p.id === patientId);
        
        if (!selectedPatient) {
            throw new Error('Paciente no encontrado en la lista local');
        }
        
        // Asignar el paciente actual
        currentPatient = selectedPatient;
        console.log('Cargando datos para paciente:', currentPatient.id);
        
        // Limpiar registros anteriores
        allRecords = [];
        
        // Cargar registros médicos
        let recordsFromFirebase = await loadRecordsFromFirebase(patientId);
        
        if (recordsFromFirebase && recordsFromFirebase.length > 0) {
            console.log('Registros cargados desde Firebase:', recordsFromFirebase.length);
            allRecords = recordsFromFirebase;
        } else {
            console.log('Cargando registros desde FHIR...');
            
            // Si no hay registros en Firebase, cargar desde FHIR
            const encountersResponse = await fetch(
                `${FHIR_SERVER}/Encounter?patient=${patientId}&_sort=-date&_count=100`,
                { headers: { 'Accept': 'application/fhir+json' } }
            );
            
            if (encountersResponse.ok) {
                const encountersData = await encountersResponse.json();
                const encounters = encountersData.entry?.map(entry => entry.resource) || [];
                
                console.log('Encounters encontrados:', encounters.length);
                
                allRecords = [];
                for (const encounter of encounters) {
                    const record = await buildFullRecord(encounter);
                    allRecords.push(record);
                }
                
                // Guardar en Firebase para futuras consultas
                if (allRecords.length > 0) {
                    await saveRecordsToFirebase(patientId, allRecords);
                }
            } else {
                console.log('No se pudieron cargar encounters desde FHIR');
            }
        }
        
        console.log('Total de registros cargados:', allRecords.length);
        
        // Mostrar información del paciente DESPUÉS de cargar los registros
        updatePatientSummary(currentPatient);
        updateMedicalRecords(allRecords);
        
        // Depuración automática en desarrollo
        if (window.location.hostname === 'localhost') {
            debugPatientData();
        }
        
    } catch (error) {
        console.error('Error cargando datos del paciente:', error);
        clearPatientData();
        showError('Error al cargar datos del paciente: ' + error.message);
    }
}


    // 12. Cargar registros desde Firebase
    async function loadRecordsFromFirebase(patientId) {
        try {
            const snapshot = await database.ref(`patients/${patientId}/records`).once('value');
            const records = snapshot.val();
            
            if (records) {
                return Object.values(records).map(record => {
                    record.fromFirebase = true;
                    return {
                        encounter: record.encounter,
                        conditions: record.conditions || [],
                        observations: record.observations || [],
                        medications: record.medications || []
                    };
                });
            }
            return null;
        } catch (error) {
            console.error('Error cargando registros desde Firebase:', error);
            return null;
        }
    }

    // 13. Guardar registros en Firebase
    async function saveRecordsToFirebase(patientId, records) {
        try {
            const recordsRef = database.ref(`patients/${patientId}/records`);
            
            const recordsObject = {};
            records.forEach((record, index) => {
                recordsObject[`record_${index}`] = {
                    encounter: record.encounter,
                    conditions: record.conditions,
                    observations: record.observations,
                    medications: record.medications,
                    lastUpdated: new Date().toISOString()
                };
            });
            
            await recordsRef.set(recordsObject);
        } catch (error) {
            console.error('Error guardando registros en Firebase:', error);
        }
    }

    async function buildFullRecord(encounter) {
    const record = {
        encounter: encounter,
        conditions: [],
        observations: [],
        medications: []
    };
    
    // Obtener diagnósticos (Conditions) - Asegurarse de incluir todos los relacionados
    try {
        const conditionsResponse = await fetch(
            `${FHIR_SERVER}/Condition?subject=Patient/${encounter.subject?.reference?.split('/')[1]}`,
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
    // 15. Actualizar resumen del paciente (VERSIÓN REACTIVA)
function updatePatientSummary(patient) {
    if (!patient || !patient.id) {
        console.error('Paciente inválido para mostrar resumen');
        return;
    }

    const name = getPatientName(patient);
    const gender = getGenderDisplay(patient.gender);
    const birthDate = patient.birthDate ? formatDate(patient.birthDate) : 'N/A';
    const age = patient.birthDate ? calculateAge(patient.birthDate) : 'N/A';
    const identifier = patient.identifier?.[0]?.value || 'N/A';

    // Verificar si ya existe el contenedor, si no, crearlo
    if (!patientSummary.querySelector('.patient-summary-content')) {
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
                            <div class="stat-value" data-stat="consultas">0</div>
                            <div class="stat-label">Consultas</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value" data-stat="diagnosticos">0</div>
                            <div class="stat-label">Diagnósticos</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value" data-stat="tratamientos">0</div>
                            <div class="stat-label">Tratamientos</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // Calcular los nuevos valores
    const recordsForPatient = allRecords.filter(record => {
        return record.encounter?.subject?.reference === `Patient/${patient.id}` ||
               record.encounter?.patient?.reference === `Patient/${patient.id}`;
    });

    const totalConsultas = recordsForPatient.length;

    // Contar diagnósticos únicos para este paciente
    const diagnosticosUnicos = new Set();
    recordsForPatient.forEach(record => {
        record.conditions?.forEach(condition => {
            if (condition.subject?.reference === `Patient/${patient.id}` || 
                !condition.subject) {
                const codigo = condition.code?.coding?.[0]?.code || condition.code?.text;
                if (codigo) diagnosticosUnicos.add(codigo);
            }
        });
    });
    const totalDiagnosticos = diagnosticosUnicos.size;

    // Contar tratamientos únicos para este paciente
    const tratamientosUnicos = new Set();
    recordsForPatient.forEach(record => {
        record.medications?.forEach(medication => {
            if (medication.subject?.reference === `Patient/${patient.id}` || 
                !medication.subject) {
                const codigo = medication.medicationCodeableConcept?.coding?.[0]?.code || 
                              medication.medicationCodeableConcept?.text;
                if (codigo) tratamientosUnicos.add(codigo);
            }
        });
    });
    const totalTratamientos = tratamientosUnicos.size;

    // Actualizar los valores de forma animada
    animateStatValue('consultas', totalConsultas);
    animateStatValue('diagnosticos', totalDiagnosticos);
    animateStatValue('tratamientos', totalTratamientos);
}

// Función para animar el cambio de valores en las estadísticas
function animateStatValue(statType, newValue) {
    const statElement = document.querySelector(`[data-stat="${statType}"]`);
    if (!statElement) return;

    const currentValue = parseInt(statElement.textContent) || 0;
    
    // Si el valor es el mismo, no hacer nada
    if (currentValue === newValue) return;

    // Agregar clase de animación
    statElement.classList.add('stat-updating');
    
    // Animar el contador
    const duration = 1000; // 1 segundo
    const startTime = performance.now();
    const startValue = currentValue;
    const valueChange = newValue - startValue;

    function updateCounter(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Usar easing para suavizar la animación
        const easedProgress = easeOutCubic(progress);
        const currentDisplayValue = Math.round(startValue + (valueChange * easedProgress));
        
        statElement.textContent = currentDisplayValue;
        
        // Agregar efecto de pulso cuando el valor cambia
        if (progress < 1) {
            requestAnimationFrame(updateCounter);
        } else {
            // Animación completada
            statElement.classList.remove('stat-updating');
            statElement.classList.add('stat-updated');
            
            // Remover la clase después de la animación
            setTimeout(() => {
                statElement.classList.remove('stat-updated');
            }, 500);
        }
    }
    
    requestAnimationFrame(updateCounter);
}

// Función de easing para suavizar la animación
function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

// Función para actualizar estadísticas en tiempo real (llamar después de guardar un registro)
function updatePatientStatsRealTime() {
    if (currentPatient) {
        // Recalcular solo las estadísticas sin recrear todo el HTML
        const recordsForPatient = allRecords.filter(record => {
            return record.encounter?.subject?.reference === `Patient/${currentPatient.id}` ||
                   record.encounter?.patient?.reference === `Patient/${currentPatient.id}`;
        });

        const totalConsultas = recordsForPatient.length;

        const diagnosticosUnicos = new Set();
        recordsForPatient.forEach(record => {
            record.conditions?.forEach(condition => {
                if (condition.subject?.reference === `Patient/${currentPatient.id}` || 
                    !condition.subject) {
                    const codigo = condition.code?.coding?.[0]?.code || condition.code?.text;
                    if (codigo) diagnosticosUnicos.add(codigo);
                }
            });
        });
        const totalDiagnosticos = diagnosticosUnicos.size;

        const tratamientosUnicos = new Set();
        recordsForPatient.forEach(record => {
            record.medications?.forEach(medication => {
                if (medication.subject?.reference === `Patient/${currentPatient.id}` || 
                    !medication.subject) {
                    const codigo = medication.medicationCodeableConcept?.coding?.[0]?.code || 
                                  medication.medicationCodeableConcept?.text;
                    if (codigo) tratamientosUnicos.add(codigo);
                }
            });
        });
        const totalTratamientos = tratamientosUnicos.size;

        // Actualizar con animación
        animateStatValue('consultas', totalConsultas);
        animateStatValue('diagnosticos', totalDiagnosticos);
        animateStatValue('tratamientos', totalTratamientos);
    }
}
    // 16. Actualizar lista de registros médicos
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
        
        medicalRecords.innerHTML = records.map((record, index) => {
            const encounter = record.encounter;
            const date = encounter.period?.start ? formatDateTime(encounter.period.start) : 'Fecha desconocida';
            const type = getEncounterTypeDisplay(encounter.class?.code);
            
            // Obtener texto de vista previa
            let previewText = '';
            if (record.conditions && record.conditions.length > 0) {
                previewText = record.conditions[0].code?.text || 'Diagnóstico registrado';
            } else if (record.observations && record.observations.length > 0) {
                previewText = record.observations[0].code?.text || 'Observación registrada';
            } else if (record.medications && record.medications.length > 0) {
                previewText = record.medications[0].medicationCodeableConcept?.text || 'Tratamiento registrado';
            } else {
                previewText = 'Consulta sin detalles registrados';
            }
            
            // Agregar indicador de origen (FHIR o Firebase)
            const source = record.fromFirebase ? ' (Firebase)' : ' (FHIR)';
            
            return `
                <div class="record-item" data-record-index="${index}">
                    <div class="record-header">
                        <span class="record-type">${type}${source}</span>
                        <span class="record-date">${date}</span>
                    </div>
                    <div class="record-preview">${previewText}</div>
                </div>
            `;
        }).join('');
        
        // Agregar event listeners a los registros
        document.querySelectorAll('.record-item').forEach(item => {
            item.addEventListener('click', () => {
                const recordIndex = item.dataset.recordIndex;
                const record = allRecords[recordIndex];
                showRecordDetails(record);
            });
        });
    }

    // 17. Mostrar detalles completos de un registro
    function showRecordDetails(record) {
        const encounter = record.encounter;
        const recordDate = encounter.period?.start ? formatDateTime(encounter.period.start) : 'Fecha desconocida';
        let recordType = getEncounterTypeDisplay(encounter.class?.code);
        
        document.getElementById('detail-record-date').textContent = recordDate;
        document.getElementById('detail-record-type').textContent = recordType;
        
        let contentHTML = '';
        
        // Mostrar notas del encuentro
        if (encounter.note && encounter.note.length > 0) {
            contentHTML += `
                <h5>Notas generales</h5>
                <p>${encounter.note[0].text}</p>
            `;
        }
        
        // Mostrar diagnósticos
        if (record.conditions && record.conditions.length > 0) {
            contentHTML += '<h5>Diagnósticos</h5>';
            record.conditions.forEach(condition => {
                const code = condition.code?.coding?.[0]?.code || 'No especificado';
                const text = condition.code?.text || 'Diagnóstico sin descripción';
                const severity = condition.severity?.coding?.[0]?.display || 'No especificada';
                
                contentHTML += `
                    <div class="detail-item">
                        <strong>Código:</strong> ${code}<br>
                        <strong>Descripción:</strong> ${text}<br>
                        <strong>Severidad:</strong> ${severity}
                    </div>
                `;
            });
        }
        
        // Mostrar observaciones
        if (record.observations && record.observations.length > 0) {
            contentHTML += '<h5>Observaciones</h5>';
            record.observations.forEach(obs => {
                const type = obs.code?.text || obs.code?.coding?.[0]?.display || 'Observación';
                const value = obs.valueQuantity?.value || 'N/A';
                const unit = obs.valueQuantity?.unit || '';
                const notes = obs.note?.[0]?.text || '';
                
                contentHTML += `
                    <div class="detail-item">
                        <strong>${type}:</strong> ${value} ${unit}<br>
                        ${notes ? `<strong>Notas:</strong> ${notes}` : ''}
                    </div>
                `;
            });
        }
        
        // Mostrar medicaciones
        if (record.medications && record.medications.length > 0) {
            contentHTML += '<h5>Tratamientos</h5>';
            record.medications.forEach(med => {
                const medication = med.medicationCodeableConcept?.text || 'Medicamento no especificado';
                const instructions = med.dosageInstruction?.[0]?.text || 'Instrucciones no especificadas';
                
                contentHTML += `
                    <div class="detail-item">
                        <strong>Medicamento:</strong> ${medication}<br>
                        <strong>Instrucciones:</strong> ${instructions}
                    </div>
                `;
            });
        }
        
        document.getElementById('detail-record-content').innerHTML = contentHTML;
        recordDetailModal.style.display = 'flex';
    }

    // 18. Abrir modal de nuevo registro
    function openNewRecordModal() {
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
        
        // Mostrar modal
        newRecordModal.style.display = 'flex';
    }

    // 19. Guardar nuevo registro médico (VERSIÓN REACTIVA)
async function saveMedicalRecord() {
    const form = document.getElementById('record-form');
    const recordType = document.getElementById('record-type').value;
    const recordDate = document.getElementById('record-date').value;
    const notes = document.getElementById('record-notes').value;
    
    if (!currentPatient || !recordType || !recordDate) {
        alert('Complete todos los campos requeridos');
        return;
    }
    
    try {
        // Mostrar indicador de carga en las estadísticas
        document.querySelectorAll('.stat-item').forEach(item => {
            item.classList.add('loading');
        });

        // 1. Crear recurso Encounter (consulta)
        const encounter = await createEncounter(recordDate);
        
        // 2. Crear recursos según el tipo de registro
        let newCondition = null;
        let newMedication = null;
        let newObservation = null;
        
        if (recordType === 'diagnosis') {
            newCondition = await createDiagnosis(encounter);
        } else if (recordType === 'treatment') {
            newMedication = await createTreatment(encounter);
        } else if (recordType === 'observation') {
            newObservation = await createObservation(encounter);
        }
        
        // 3. Agregar notas generales si existen
        if (notes) {
            await updateEncounterWithNotes(encounter.id, notes);
        }
        
        // 4. Construir el nuevo registro para Firebase
        const newRecord = {
            encounter: encounter,
            conditions: newCondition ? [newCondition] : [],
            observations: newObservation ? [newObservation] : [],
            medications: newMedication ? [newMedication] : [],
            lastUpdated: new Date().toISOString()
        };
        
        // 5. Agregar el nuevo registro a Firebase
        const newRecordRef = database.ref(`patients/${currentPatient.id}/records`).push();
        await newRecordRef.set(newRecord);
        
        // 6. Actualizar la lista de registros localmente
        allRecords.unshift(newRecord);
        
        // 7. Actualizar la UI de forma reactiva
        updateMedicalRecords(allRecords);
        
        // 8. Actualizar estadísticas con animación
        setTimeout(() => {
            // Remover indicadores de carga
            document.querySelectorAll('.stat-item').forEach(item => {
                item.classList.remove('loading');
            });
            
            // Actualizar estadísticas de forma reactiva
            updatePatientStatsRealTime();
            
            // Resaltar si hay cambios significativos (más de 5 registros nuevos)
            if (allRecords.length > 5) {
                document.querySelectorAll('.stat-value').forEach(stat => {
                    stat.classList.add('significant-change');
                    setTimeout(() => {
                        stat.classList.remove('significant-change');
                    }, 2000);
                });
            }
        }, 500); // Pequeño delay para que se vea la animación de carga
        
        // 9. Cerrar modal
        newRecordModal.style.display = 'none';
        
        // 10. Mostrar notificación de éxito
        showSuccessNotification('Registro médico guardado exitosamente');
        
    } catch (error) {
        console.error('Error guardando registro:', error);
        
        // Remover indicadores de carga en caso de error
        document.querySelectorAll('.stat-item').forEach(item => {
            item.classList.remove('loading');
        });
        
        alert('Error al guardar el registro: ' + error.message);
    }
}

// Función para mostrar notificaciones de éxito
function showSuccessNotification(message) {
    // Crear elemento de notificación si no existe
    let notification = document.getElementById('success-notification');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'success-notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background-color: #10b981;
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 1000;
            transform: translateX(100%);
            transition: transform 0.3s ease;
            max-width: 300px;
        `;
        document.body.appendChild(notification);
    }
    
    notification.textContent = message;
    
    // Mostrar notificación
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Ocultar después de 3 segundos
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
    }, 3000);
}

// También actualizar la función loadPatientData para usar la actualización reactiva
async function loadPatientDataReactive(patientId) {
    try {
        showLoadingState();
        
        const selectedPatient = allPatients.find(p => p.id === patientId);
        
        if (!selectedPatient) {
            throw new Error('Paciente no encontrado en la lista local');
        }
        
        currentPatient = selectedPatient;
        allRecords = [];
        
        // Crear la estructura básica primero
        updatePatientSummary(currentPatient);
        
        // Cargar registros médicos
        let recordsFromFirebase = await loadRecordsFromFirebase(patientId);
        
        if (recordsFromFirebase && recordsFromFirebase.length > 0) {
            allRecords = recordsFromFirebase;
        } else {
            const encountersResponse = await fetch(
                `${FHIR_SERVER}/Encounter?patient=${patientId}&_sort=-date&_count=100`,
                { headers: { 'Accept': 'application/fhir+json' } }
            );
            
            if (encountersResponse.ok) {
                const encountersData = await encountersResponse.json();
                const encounters = encountersData.entry?.map(entry => entry.resource) || [];
                
                allRecords = [];
                for (const encounter of encounters) {
                    const record = await buildFullRecord(encounter);
                    allRecords.push(record);
                }
                
                if (allRecords.length > 0) {
                    await saveRecordsToFirebase(patientId, allRecords);
                }
            }
        }
        
        // Actualizar UI con animaciones
        updateMedicalRecords(allRecords);
        updatePatientStatsRealTime(); // Usar la versión reactiva
        
    } catch (error) {
        console.error('Error cargando datos del paciente:', error);
        clearPatientData();
        showError('Error al cargar datos del paciente: ' + error.message);
    }
}

    // 20. Funciones para crear recursos FHIR
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
                start: new Date(dateTime).toISOString(),
                end: new Date(dateTime).toISOString()
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
            throw new Error(error.issue?.[0]?.diagnostics || 'Error al crear consulta');
        }
        
        return await response.json();
    }

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
            throw new Error(error.issue?.[0]?.diagnostics || 'Error al crear diagnóstico');
        }
        
        return await response.json();
    }

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
            throw new Error(error.issue?.[0]?.diagnostics || 'Error al crear tratamiento');
        }
        
        return await response.json();
    }

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
            throw new Error(error.issue?.[0]?.diagnostics || 'Error al crear observación');
        }
        
        return await response.json();
    }

    // 21. Actualizar un Encounter con notas
    async function updateEncounterWithNotes(encounterId, notes) {
        // Primero obtenemos el recurso actual
        const getResponse = await fetch(`${FHIR_SERVER}/Encounter/${encounterId}`, {
            headers: { 'Accept': 'application/fhir+json' }
        });
        
        if (!getResponse.ok) {
            throw new Error('Error al obtener el encuentro para actualizar');
        }
        
        const encounterResource = await getResponse.json();
        
        // Agregar notas al recurso
        encounterResource.note = [{
            text: notes,
            time: new Date().toISOString()
        }];
        
        const updateResponse = await fetch(`${FHIR_SERVER}/Encounter/${encounterId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/fhir+json',
                'Accept': 'application/fhir+json'
            },
            body: JSON.stringify(encounterResource)
        });
        
        if (!updateResponse.ok) {
            const error = await updateResponse.json();
            throw new Error(error.issue?.[0]?.diagnostics || 'Error al actualizar consulta con notas');
        }
        
        return await updateResponse.json();
    }

    // 22. Funciones auxiliares de UI
    function clearPatientData() {
        currentPatient = null;
        allRecords = [];
        patientSummary.innerHTML = `
            <div class="empty-state">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                </svg>
                <p>Seleccione un paciente para ver su información</p>
            </div>
        `;
        medicalRecords.innerHTML = '';
    }

    function showLoadingState() {
        patientSummary.innerHTML = `
            <div class="loading-state">
                <div class="loading-spinner"></div>
                <p>Cargando datos...</p>
            </div>
        `;
    }

    function showError(message) {
        patientSummary.innerHTML = `
            <div class="error-state">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <p>${message}</p>
            </div>
        `;
    }           
    
    function showInfo(message) {
        patientSummary.innerHTML = `
            <div class="info-state">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                <p>${message}</p>
            </div>
        `;
    }

    // 23. Funciones utilitarias
    function getPatientName(patient) {
        if (!patient || !patient.name || patient.name.length === 0) {
            return 'Sin nombre registrado';
        }
        
        const name = patient.name[0];
        const given = name.given || [];
        const family = name.family || '';
        
        return `${given.join(' ')} ${family}`.trim();
    }

    function getInitials(name) {
        if (!name || name === 'Sin nombre registrado') return '?';
        
        return name
            .split(' ')
            .map(word => word.charAt(0).toUpperCase())
            .slice(0, 2)
            .join('');
    }

    function formatDate(dateString) {
        if (!dateString) return 'N/A';
        
        const date = new Date(dateString);
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        
        return `${day}/${month}/${year}`;
    }

    function formatDateTime(dateTimeString) {
        if (!dateTimeString) return 'N/A';
        
        const date = new Date(dateTimeString);
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }

    function calculateAge(birthDateString) {
        const birthDate = new Date(birthDateString);
        const today = new Date();
        
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        
        return age;
    }

    function getGenderDisplay(gender) {
        const genderMap = {
            'male': 'Masculino',
            'female': 'Femenino',
            'other': 'Otro',
            'unknown': 'No especificado'
        };
        
        return genderMap[gender] || 'No especificado';
    }

    function getEncounterTypeDisplay(code) {
        const encounterTypes = {
            'AMB': 'Consulta ambulatoria',
            'EMER': 'Emergencia',
            'HH': 'Atención domiciliaria',
            'IMP': 'Hospitalización',
            'ACUTE': 'Cuidado agudo',
            'NONAC': 'Cuidado no agudo',
            'OBSENC': 'Observación',
            'PRENC': 'Pre-admisión',
            'SS': 'Consulta breve',
            'VR': 'Consulta virtual'
        };
        
        return encounterTypes[code] || 'Consulta médica';
    }

    // 24. Manejo de cierre de sesión
    document.querySelector('.logout-btn').addEventListener('click', function() {
        sessionStorage.removeItem('currentMediConnectUser');
        window.location.href = '../auth/login.html';
    });

    // Función para actualizar la lista de pacientes en el select
function updatePatientSelect(patients) {
    patientSelect.innerHTML = '<option value="">Seleccionar paciente...</option>';
    
    patients.forEach(patient => {
        const name = getPatientName(patient);
        const identifier = patient.identifier?.[0]?.value || 'Sin ID';
        
        const option = document.createElement('option');
        option.value = patient.id;
        option.textContent = `${name} (${identifier})`;
        option.setAttribute('data-patient-id', patient.id);
        // Almacenar el objeto completo del paciente como atributo data
        option.dataset.patientData = JSON.stringify({
            name: patient.name,
            gender: patient.gender,
            birthDate: patient.birthDate,
            identifier: patient.identifier
        });
        patientSelect.appendChild(option);
    });
}

    // 26. Manejo de eventos adicionales
    window.addEventListener('online', () => {
        showInfo('Conexión a internet restaurada.');
    });

    window.addEventListener('offline', () => {
        showError('Conexión a internet perdida. Algunas funciones pueden no estar disponibles.');
    });
});