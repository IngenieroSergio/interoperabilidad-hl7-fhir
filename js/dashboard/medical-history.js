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
    let allRecords = [];

    // Elementos del DOM
    const patientSelect = document.getElementById('patient-select');
    const newRecordBtn = document.getElementById('new-record-btn');
    const patientSummary = document.getElementById('patient-summary');
    const medicalRecords = document.getElementById('medical-records');
    const newRecordModal = document.getElementById('new-record-modal');
    const recordDetailModal = document.getElementById('record-detail-modal');
    const cancelRecordBtn = document.getElementById('cancel-record-btn');

    // Inicializar
    loadPatients();
    setupEventListeners();

    // Cargar lista de pacientes
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

        // Cerrar modales con botón X
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', function() {
                newRecordModal.style.display = 'none';
                recordDetailModal.style.display = 'none';
            });
        });

        // Cerrar modales al hacer clic fuera
        window.addEventListener('click', function(e) {
            if (e.target === newRecordModal) {
                newRecordModal.style.display = 'none';
            }
            if (e.target === recordDetailModal) {
                recordDetailModal.style.display = 'none';
            }
        });

        // Botón cancelar en modal de nuevo registro
        cancelRecordBtn.addEventListener('click', function() {
            newRecordModal.style.display = 'none';
        });

        // Manejar cambio de tipo de registro
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

        // Imprimir registro
        document.getElementById('print-record-btn').addEventListener('click', function() {
            window.print();
        });

        // Formulario de nuevo registro
        document.getElementById('record-form').addEventListener('submit', function(e) {
            e.preventDefault();
            saveMedicalRecord();
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
            
            // Obtener encuentros (consultas) del paciente
            const encountersResponse = await fetch(
                `${FHIR_SERVER}/Encounter?patient=${patientId}&_sort=-date&_count=100`,
                { headers: { 'Accept': 'application/fhir+json' } }
            );
            
            if (!encountersResponse.ok) throw new Error('Error al cargar historial');
            
            const encountersData = await encountersResponse.json();
            const encounters = encountersData.entry?.map(entry => entry.resource) || [];
            
            // Para cada encuentro, obtener diagnósticos, observaciones, etc.
            allRecords = [];
            for (const encounter of encounters) {
                const record = await buildFullRecord(encounter);
                allRecords.push(record);
            }
            
            updatePatientSummary(currentPatient);
            updateMedicalRecords(allRecords);
            
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
        
        // Calcular estadísticas
        const totalConsultas = allRecords.length;
        const totalDiagnosticos = allRecords.reduce((sum, record) => sum + (record.conditions?.length || 0), 0);
        const totalTratamientos = allRecords.reduce((sum, record) => sum + (record.medications?.length || 0), 0);
        
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
                            <div class="stat-value">${totalConsultas}</div>
                            <div class="stat-label">Consultas</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${totalDiagnosticos}</div>
                            <div class="stat-label">Diagnósticos</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${totalTratamientos}</div>
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
            
            return `
                <div class="record-item" data-record-index="${index}">
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
                const recordIndex = item.dataset.recordIndex;
                const record = allRecords[recordIndex];
                showRecordDetails(record);
            });
        });
    }

    // Mostrar detalles completos de un registro
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

    // Abrir modal de nuevo registro
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

    // Guardar nuevo registro médico
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
                await updateEncounterWithNotes(encounter.id, notes);
            }
            
            // 4. Recargar datos del paciente
            await loadPatientData(currentPatient.id);
            
            // 5. Cerrar modal
            newRecordModal.style.display = 'none';
            
        } catch (error) {
            console.error('Error guardando registro:', error);
            alert('Error al guardar el registro: ' + error.message);
        }
    }

    // Crear un Encounter en FHIR
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

    // Crear un Diagnosis (Condition) en FHIR
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

    // Crear un Treatment (MedicationRequest) en FHIR
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

    // Crear una Observation en FHIR
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

    // Actualizar un Encounter con notas
    async function updateEncounterWithNotes(encounterId, notes) {
        // Primero obtenemos el recurso actual para no sobrescribir datos existentes
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
        
        // Continuar desde donde se cortó el código (dentro de la función updateEncounterWithNotes)
        if (!updateResponse.ok) {
            const error = await updateResponse.json();
            throw new Error(error.issue?.[0]?.diagnostics || 'Error al actualizar consulta con notas');
        }
        
        return await updateResponse.json();
    }

    // Limpiar datos del paciente
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

    // Mostrar estado de carga
    function showLoadingState() {
        patientSummary.innerHTML = `
            <div class="loading-state">
                <div class="loading-spinner"></div>
                <p>Cargando datos...</p>
            </div>
        `;
    }

    // Mostrar mensaje de error
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

    // Mostrar mensaje informativo
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

    // Funciones auxiliares

    // Obtener nombre del paciente
    function getPatientName(patient) {
        if (!patient || !patient.name || patient.name.length === 0) {
            return 'Sin nombre registrado';
        }
        
        const name = patient.name[0];
        const given = name.given || [];
        const family = name.family || '';
        
        return `${given.join(' ')} ${family}`.trim();
    }

    // Obtener iniciales del nombre
    function getInitials(name) {
        if (!name || name === 'Sin nombre registrado') return '?';
        
        return name
            .split(' ')
            .map(word => word.charAt(0).toUpperCase())
            .slice(0, 2)
            .join('');
    }

    // Formatear fecha
    function formatDate(dateString) {
        if (!dateString) return 'N/A';
        
        const date = new Date(dateString);
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        
        return `${day}/${month}/${year}`;
    }

    // Formatear fecha y hora
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

    // Calcular edad basada en fecha de nacimiento
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

    // Mostrar texto para género
    function getGenderDisplay(gender) {
        const genderMap = {
            'male': 'Masculino',
            'female': 'Femenino',
            'other': 'Otro',
            'unknown': 'No especificado'
        };
        
        return genderMap[gender] || 'No especificado';
    }

    // Mostrar tipo de consulta
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

    // Manejar cierre de sesión
    document.getElementById('logout-btn')?.addEventListener('click', function() {
        sessionStorage.removeItem('currentMediConnectUser');
        window.location.href = '../auth/login.html';
    });

    // Función para exportar historia clínica en formato PDF
    document.getElementById('export-medical-history-btn')?.addEventListener('click', function() {
        if (!currentPatient) {
            alert('Seleccione un paciente primero');
            return;
        }
        
        alert('Función de exportación a PDF en desarrollo');
        // TODO: Implementar exportación a PDF usando una biblioteca como jsPDF
    });

    // Búsqueda de pacientes
    const searchInput = document.getElementById('search-patient');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase();
            const options = patientSelect.options;
            
            for (let i = 1; i < options.length; i++) {
                const optionText = options[i].textContent.toLowerCase();
                if (optionText.includes(searchTerm)) {
                    options[i].style.display = '';
                } else {
                    options[i].style.display = 'none';
                }
            }
        });
    }

    // Funcionalidad para filtrar registros médicos
    const filterSelect = document.getElementById('filter-records');
    if (filterSelect) {
        filterSelect.addEventListener('change', function() {
            const filterValue = this.value;
            const recordItems = document.querySelectorAll('.record-item');
            
            recordItems.forEach(item => {
                const recordIndex = item.dataset.recordIndex;
                const record = allRecords[recordIndex];
                
                // Filtrar según el tipo seleccionado
                if (filterValue === 'all') {
                    item.style.display = '';
                } else if (filterValue === 'diagnosis' && record.conditions.length > 0) {
                    item.style.display = '';
                } else if (filterValue === 'treatment' && record.medications.length > 0) {
                    item.style.display = '';
                } else if (filterValue === 'observation' && record.observations.length > 0) {
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            });
        });
    }

    // Manejar errores de conexión con el servidor FHIR
    window.addEventListener('offline', () => {
        showError('Conexión a internet perdida. Algunas funciones pueden no estar disponibles.');
    });

    window.addEventListener('online', () => {
        showInfo('Conexión a internet restaurada.');
    });

    // Validar campos del formulario de nuevo registro
    document.getElementById('record-form').addEventListener('input', function(e) {
        const submitBtn = document.getElementById('save-record-btn');
        const recordType = document.getElementById('record-type').value;
        const recordDate = document.getElementById('record-date').value;
        
        let isValid = recordType && recordDate;
        
        // Validaciones específicas según el tipo de registro
        if (recordType === 'diagnosis') {
            const description = document.getElementById('diagnosis-description').value;
            isValid = isValid && description;
        } else if (recordType === 'treatment') {
            const medication = document.getElementById('treatment-medication').value;
            isValid = isValid && medication;
        } else if (recordType === 'observation') {
            const value = document.getElementById('observation-value').value;
            isValid = isValid && value;
        }
        
        submitBtn.disabled = !isValid;
    });

    // Manejo de estado activo para navegación
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        if (window.location.href.includes(item.getAttribute('href'))) {
            item.classList.add('active');
        }
        
        item.addEventListener('click', function() {
            navItems.forEach(i => i.classList.remove('active'));
            this.classList.add('active');
        });
    });

    // Obtener últimos valores vitales para mostrar en la vista de resumen
    async function getLatestVitalSigns() {
        if (!currentPatient) return null;
        
        try {
            const response = await fetch(
                `${FHIR_SERVER}/Observation?patient=${currentPatient.id}&category=vital-signs&_count=5&_sort=-date`,
                { headers: { 'Accept': 'application/fhir+json' } }
            );
            
            if (!response.ok) return null;
            
            const data = await response.json();
            return data.entry?.map(entry => entry.resource) || [];
        } catch (e) {
            console.error('Error cargando signos vitales:', e);
            return null;
        }
    }

    // Obtener los diagnósticos activos más recientes
    async function getActiveConditions() {
        if (!currentPatient) return null;
        
        try {
            const response = await fetch(
                `${FHIR_SERVER}/Condition?patient=${currentPatient.id}&clinical-status=active&_count=5&_sort=-date`,
                { headers: { 'Accept': 'application/fhir+json' } }
            );
            
            if (!response.ok) return null;
            
            const data = await response.json();
            return data.entry?.map(entry => entry.resource) || [];
        } catch (e) {
            console.error('Error cargando condiciones activas:', e);
            return null;
        }
    }

    // Funcionalidad para verificar conexión con servidor FHIR
    async function checkFHIRServerConnection() {
        try {
            const response = await fetch(`${FHIR_SERVER}/metadata`, {
                headers: { 'Accept': 'application/fhir+json' }
            });
            
            return response.ok;
        } catch (e) {
            console.error('Error de conexión con servidor FHIR:', e);
            return false;
        }
    }

    // Iniciar comprobación de estado del servidor
    (async function() {
        const isServerConnected = await checkFHIRServerConnection();
        
        if (!isServerConnected) {
            showError('No se pudo conectar al servidor FHIR. Verifique que el servidor esté en funcionamiento y vuelva a cargar la página.');
        }
    })();
});