# AGENT.MD - Sistema SaaS de Gestión Modular de Condominios

## 1. Visión General del Proyecto
SaaS modular para la administración, control operativo, reservas, estacionamiento y convivencia en condominios residenciales.
- **Plataforma Integral:** Desarrollado, orquestado y desplegado sobre el ecosistema **InsForge** (gestiona la integración del Backend, Database PostgreSQL, APIs, Contexto de Agentes y enlace con el Frontend en React).
- **Aislamiento Multi-Tenant:** Esquema independiente por condominio (`schema-per-tenant`) en PostgreSQL, gestionado dinámicamente.
- **Modularidad (Feature Flags):** Módulos desacoplados y activables bajo demanda mediante perfiles de configuración por condominio.
- **Frontend:** **React + TypeScript** (SPA modular con renderizado dinámico según el perfil de módulos activos provisto por InsForge).
- **Convenciones de Idioma:**
  - **Código, base de datos, APIs, herramientas/skills del agente y DTOs:** 100% en **Inglés**.
  - **Interfaz de usuario, textos, etiquetas, validaciones y mensajes de error:** 100% en **Español**.

---

## 0. Workflow del Agente — Leer siempre antes de trabajar

> Fuente única de instrucciones de trabajo. El usuario no repetirá estas reglas en cada
> mensaje: leerlas desde este fichero y mantenerlas actualizadas cuando cambien flujos,
> comandos o convenciones. Al terminar cada cambio, el agente lo entrega por su cuenta
> (commit → merge hasta `main` → push) siguiendo la sección 0.3, sin que el usuario lo pida.

### 0.1. Ramas y Git (reglas obligatorias)
- **Nunca trabajar sobre `main` directamente** y **nunca commitear/pushear commits de trabajo
  sobre `main`**.
- **Siempre crear una rama nueva a partir de `dev`** con nombre descriptivo
  (`feature/<slug>` o `fix/<slug>`).
- **`main` y `dev` deben mantenerse sincronizadas** en el mismo estado (mismo commit) al
  finalizar cualquier entrega.

Ciclo de entrega:
1. `git fetch origin` y asegurarse de estar en `dev` actualizado.
2. Crear la rama de trabajo: `git switch -c <feature|fix>/<slug> dev`.
3. Hacer los cambios, **validar con el build** (ver 0.3) y commitear **solo en la rama**.
4. Pushear la rama: `git push -u origin <feature|fix>/<slug>`.
5. Integrar a `dev`: `git switch dev` → `git merge --ff-only <rama>` → `git push origin dev`.
6. Sincronizar `main`: `git switch main` → `git merge --ff-only <rama>` → `git push origin main`.
7. Volver a `dev` como rama base de trabajo.

Si hay cambios sin commitear al cambiar de rama, trasladarlos con `git stash push`
y `git stash pop` (no perder trabajo en el checkout).

### 0.2. Mensajes de commit
- En **inglés**, estilo convencional: `feat(scope): subject` / `fix(scope): subject`.
- Un commit por cambio lógico/atómico; stagear únicamente los archivos de ese commit.

### 0.3. Entrega automática (commit → merge → push)
- Al terminar de implementar un cambio y **validar el build**, el agente **debe** entregarlo
  por sí mismo **sin esperar a que el usuario lo pida**: commitear en rama nueva desde `dev`,
  pushearla, mergearla a `dev`, mergearla a `main` y pushear ambas (ciclo de entrega del 0.1).
- Mientras haya cambios sin commitear en el árbol, el agente **no debe** dar por terminada la
  tarea; debe commitearlos y llevar la entrega hasta `main` automáticamente.
- No preguntar "¿commiteo y pusheo?" salvo que haya un conflicto, un riesgo de `--force` o una
  ambigüedad real (por ejemplo, cambios no solicitados o incompletos).

### 0.4. Validación obligatoria
- Todo cambio en `frontend/` debe validarse ejecutando `npm run build` en `frontend/`
  (ejecuta `tsc` + `vite build`). No finalizar una tarea si el build no pasa.

### 0.5. Convenciones de idioma y estilo (resumen)
- Código, funciones, APIs, DTOs, ramas, commits y nombres: **inglés**.
- Interfaz, labels, mensajes y validaciones visibles al usuario: **español**.
- React + TypeScript estricto (sin `any`), componentes organizados por módulos en
  `frontend/src/modules/`.

### 0.6. Mantener este fichero al día
- Actualizar esta sección siempre que cambien las reglas de trabajo, ramas, comandos o
  convenciones del proyecto.

---

## 2. Rol del Agente e Integración con InsForge

### 2.1. Gestión de Conectividad Frontend-Backend
- **InsForge Client / Runtime:** InsForge gestiona la comunicación, autenticación, inyección de contexto y consumo de endpoints/servicios entre el Frontend (React) y los servicios de backend.
- **Agent Skill & Service Contracts:** Toda función de backend creada debe exponerse con tipado estricto (TypeScript DTOs / Schemas) para que InsForge genere y mantenga sincronizados los contratos, hooks y clientes consumibles en React.
- **Inyección de Contexto del Tenant:** InsForge provee y propaga el `TenantContext` (`tenant_id`, `schema_name`, `user_id`, `role`, `active_modules`) en cada invocación.

---

## 3. Convenciones de Idioma y Estilo de Código

### 3.1. Nombres y Lógica de Negocio (Inglés)
- Funciones, clases, métodos, variables, endpoints, nombres de tablas, columnas y tipos.
- *Ejemplos:* `createTowerStructure()`, `processCartCheckout()`, `calculateCartOverduePenalty()`, `isModuleEnabled()`.

### 3.2. Presentación y Mensajes al Usuario (Español)
- Textos de UI, labels de formularios, descripciones de estado, notificaciones y mensajes de error estandarizados.
- *Ejemplo de respuesta estandarizada:*
  ```json
  {
    "success": false,
    "data": null,
    "error": {
      "code": "CART_OVERDUE_FINE_APPLIED",
      "message": "El carrito superó el tiempo límite. Se ha generado una penalidad por demora."
    }
  }
  ```

---

## 4. Estrategia Multi-Tenant y Activación Modular

### 4.1. Esquema Maestro (`public`)
- `tenants`: Registro comercial (`id`, `slug`, `name`, `schema_name`, `status`, `created_at`).
- `users_global`: Credenciales y estado global (`id`, `email`, `password_hash`, `is_superadmin`).
- `tenant_users`: Relación usuario-condominio y rol (`tenant_id`, `user_id`, `role`, `status`).

### 4.2. Esquemas por Condominio (`condo_{slug}`)
- `condo_settings`: Feature flags y configuración operativa por módulo (`module_key`, `is_enabled`, `config_json`, `updated_at`).

### 4.3. Reglas Operativas para el Agente:
> 1. **Resolución de Esquema:** Todo request/servicio debe resolver el tenant y fijar el `search_path` de PostgreSQL (`SET search_path TO condo_{slug}, public;`).
> 2. **Guard de Módulo:** Todo controlador o servicio de módulo opcional debe verificar en `condo_settings` si el módulo está habilitado (`is_enabled = true`). Si está deshabilitado, responder con `403 Forbidden: Módulo inactivo para este condominio`.
> 3. **Frontend Dinámico:** React debe consultar la configuración de módulos activos al iniciar sesión y ocultar rutas, componentes y navegación de módulos inactivos.

---

## 5. Matriz de Roles y Permisos (RBAC)

| Rol | Ámbito | Responsabilidades Clave |
| :--- | :--- | :--- |
| **Super Admin** | Global (`public`) | Aprovisionamiento de condominios, gestión de tenants y métricas globales SaaS. |
| **Admin Condominio** | Esquema Local | Configuración física, activación de módulos, parametrización de tiempos y multas de carritos en `condo_settings`, gestión de residentes y reportes. |
| **Agente de Seguridad** | Esquema Local | Operación en garita: validación de vehículos/peatones, entrega/recepción de carritos, cálculo visible de mora y control de áreas comunes. |
| **Residente** | Esquema Local | Gestión de su departamento, registro de vehículos, solicitud de carritos, consulta de multas acumuladas, reservas y préstamos de su estacionamiento. |
| **Visitante** | Esquema Local (Restringido) | Validación de accesos temporales y uso de estacionamientos de visitas autorizadas. |

---

## 6. Arquitectura de Módulos y Modelo de Datos

### 6.1. `core_structure` (Estructura Física y Residentes - Obligatorio)
Modela la jerarquía: **Condominio → Torres → Pisos → Departamentos**.

- **Entidades:**
  - `towers` (`id`, `name`, `code`, `floors_count`, `departments_per_floor`, `created_at`)
  - `floors` (`id`, `tower_id`, `floor_number`, `created_at`)
  - `departments` (`id`, `floor_id`, `tower_id`, `department_number`, `status` [HABITADO, DESOCUPADO, MANTENIMIENTO], `created_at`)
  - `residents` (`id`, `department_id`, `user_id`, `is_owner`, `relationship_type` [PROPIETARIO, FAMILIAR, INQUILINO], `is_primary_contact`, `created_at`)
- **Regla del Wizard:** `CoreStructureService.provisionTowerStructure()` recibe `tower_name`, `floors_count`, `deps_per_floor` y `naming_pattern` para generar en una transacción los registros de torre, pisos y departamentos.

---

### 6.2. `parking_control` (Control de estacionamientos y Préstamos - MVP)
- **Entidades:**
  - `parking_spots` (`id`, `spot_number`, `type` [PROPIO, VISITA, ALQUILADO], `department_id` [nullable], `status` [DISPONIBLE, OCUPADO], `spot_row` [fila], `spot_index` [columna])
  - `vehicles` (`id`, `department_id`, `license_plate`, `vehicle_type` [AUTO, MOTO], `brand`, `model`, `color`, `is_active`)
  - `parking_loans` (`id`, `spot_id`, `lender_department_id`, `borrower_department_id`, `borrower_vehicle_plate`, `occupant_name`, `occupant_document_type`, `occupant_document_number`, `duration_unit` [HORAS, DIAS, MESES], `start_time`, `end_time`, `status` [PENDIENTE, ACTIVO, FINALIZADO, CANCELADO]) — registra a la **persona que ocupará la plaza** si no es el dueño y por cuánto tiempo.
  - `parking_access_logs` (`id`, `spot_id`, `license_plate`, `vehicle_type` [AUTO, MOTO], `driver_name`, `entry_time`, `exit_time`, `entry_gate_id`, `exit_gate_id`, `authorized_by_user_id`, `guard_user_id`) — registra **la puerta de ingreso y la puerta de salida** por separado.
  - `guard_gate_sessions` (`id`, `user_id`, `gate_id`, `started_at`, `ended_at`) — persiste en qué puerta está autenticado cada agente de seguridad.
- **Layout del estacionamiento (configuración visual):**
  - El administrador/super admin configura en una vista propia cuántas **filas** tendrá el estacionamiento y **cuántas plazas en cada fila** (la cantidad puede variar por fila) (`provisionParkingLayout` / RPC `provision_parking_layout`).
  - Cada plaza se numera automáticamente de forma **secuencial global** (01, 02, 03 ...) y se guardan `spot_row`/`spot_index`.
  - El layout se persiste en `condo_settings.config_json` (`parking_control.layout = { rows, spots_per_row: [...] }` con `spots_per_row` como array) y la generación es **upsert por número**: conserva plazas existentes y agrega las que falten (no borra nada).
  - `parking-control` expone `get-layout` y `provision-layout` (acepta `spots_per_row` como número uniforme o array por fila). Los roles admin/super la generan desde la pestaña "Estacionamiento" (configuración visual con mapa), pudiendo hacer clic en cada plaza para asignar tipo/departamento.
  - **El mapa diferencia visualmente** las plazas: PROPIO **asignada a departamento** (verde), PROPIO **sin asignar** (gris), **ocupada** (rojo), **visita** (azul) y **alquilada** (naranja). El guardia lo ve en su panel de garita.
- **Reglas de Negocio:**
  - **Tipos de plaza:** `PROPIO` (pertenece a un departamento), `VISITA` (uso temporal en garita), `ALQUILADO` (se cede a un tercero por un período).
  - **Vehículos:** cada vehículo tiene `vehicle_type` (`AUTO` o `MOTO`). El dueño de la plaza registra sus vehículos.
  - **Regla de ocupación:** **máximo un auto estacionado a la vez por plaza**; las **motos pueden compartir** (varias motos juntas, o una moto junto a un auto). Dos autos no pueden estar a la vez en la misma plaza (`register-entry` lo valida con `spotCanHostType`).
  - **Ocupante no dueño:** el dueño o el administrador registran los **datos de la persona que ocupará la plaza** (`occupant_name`, documento) y la **duración en horas/días/meses** (`duration_unit`) al crear el préstamo. En plazas `ALQUILADO` solo el administrador puede crear el préstamo y el ocupante es obligatorio.
  - Los residentes prestan sus estacionamientos `PROPIO` a otros residentes o visitantes autorizados con ventana de tiempo (`parking_loans`). Estado inicial `PENDIENTE`, luego `ACTIVO`/`FINALIZADO`/`CANCELADO`.
  - En garita, el agente valida la placa contra: (1) el vehículo registrado del propietario con estacionamiento `PROPIO` que cumpla la regla de ocupación, (2) un préstamo `ACTIVO` dentro de la ventana de tiempo del prestatario, (3) disponibilidad de estacionamientos `VISITA`, o (4) asignación explícita por el guardia.
  - **OCR de matrículas:** el agente de seguridad registra entradas/salidas **escaneando la matrícula** (función `plate-ocr` con Google Cloud Vision `TEXT_DETECTION`, secreto `GOOGLE_VISION_API_KEY`) o **ingresándola manualmente** en el panel de garita.
  - **Sesión de puerta del guardia:** al autenticarse (o al entrar a la garita), el agente selecciona una vez la puerta en la que trabaja si el condominio tiene más de una; queda guardada en `guard_gate_sessions` (una sesión activa por usuario). Ese gate se usa por defecto en los préstamos de carritos (`cart_loans`) y en los `parking_access_logs`, sin volver a seleccionarlo en cada operación. El agente puede cambiarla con confirmación (cierra la sesión vigente y abre una nueva).
  - **Múltiples entradas/salidas:** un condominio tiene `condo_gates.is_entry_exit`. Un vehículo puede ingresar por una puerta y salir por esa misma o por otra (`entry_gate_id` / `exit_gate_id` independientes).
  - **Máquina de estado dentro/fuera:** si el vehículo tiene un `parking_access_logs` abierto (`exit_time IS NULL`), está dentro y **solo se le puede registrar salida**; si no tiene ninguno abierto, está fuera y **solo se le puede registrar ingreso**.
  - El estado `OCUPADO/DISPONIBLE` de `parking_spots` se sincroniza automáticamente al registrar ingreso/salida (una plaza sigue `OCUPADO` mientras quede cualquier vehículo dentro).

---

### 6.3. `cart_lending` (Préstamo de Carritos de Carga y Multas - MVP)
- **Configuración en `condo_settings` (Clave `cart_lending`):**
  ```json
  {
    "max_loan_minutes": 60,
    "fine_enabled": true,
    "fine_type": "FIXED_OR_PER_INTERVAL",
    "grace_period_minutes": 10,
    "fine_amount": 5.00,
    "fine_interval_minutes": 30
  }
  ```
- **Entidades:**
  - `carts` (`id`, `code_identifier`, `qr_code_hash`, `status` [DISPONIBLE, PRESTADO, MANTENIMIENTO], `notes`)
  - `cart_loans` (`id`, `cart_id`, `department_id`, `requested_by_user_id`, `guard_checkout_user_id`, `guard_checkin_user_id`, `checkout_time`, `due_time`, `checkin_time`, `status` [ACTIVO, DEVUELTO, ATRASADO], `penalty_amount`, `penalty_status` [NINGUNA, PENDIENTE, COBRADA, EXONERADA])
- **Reglas de Negocio:**
  - **Tiempos y Tolerancia:** Al realizar el checkout (`processCartCheckout`), `due_time` se calcula como `checkout_time + max_loan_minutes`. Si existe período de gracia (`grace_period_minutes`), la multa no se aplica hasta superarlo.
  - **Cálculo de Multa:** Si `checkin_time > due_time` y `fine_enabled == true`, el servicio calcula el monto según la tarifa (`fine_amount`) y el intervalo por exceso de tiempo (`fine_interval_minutes`), registrando la deuda en `cart_loans.penalty_amount`.
  - **Integración con Facturación:** Si el módulo `billing_maintenance` está activo, la multa se vincula al estado de cuenta del departamento infractor.
  - **Puerta del guardia en préstamos:** en el checkout el carrito se preselecciona entre los de la puerta donde está autenticado el agente (ver `guard_gate_sessions`), evitando re-seleccionar la puerta en cada préstamo.

---

### 6.4. `common_areas` (Reserva de Áreas Comunes - MVP)
- **Entidades:**
  - `common_areas` (`id`, `name`, `capacity`, `requires_approval`, `cost_per_hour`, `min_hours`, `max_hours`, `rules_text`, `is_active`)
  - `area_schedules` (`id`, `area_id`, `day_of_week`, `opening_time`, `closing_time`)
  - `area_bookings` (`id`, `area_id`, `department_id`, `user_id`, `start_datetime`, `end_datetime`, `guest_count`, `status` [SOLICITADA, APROBADA, RECHAZADA, CANCELADA, FINALIZADA], `notes`)
- **Reglas de Negocio:**
  - Validación anti-solapamiento estricta en base de datos.
  - Panel en garita con la lista de eventos autorizados y aforo del día.

---

### 6.5. Módulos Fase 2 (Post-MVP)
- `visitor_access`: Pases QR para visitas y control de paquetería/delivery en garita.
- `billing_maintenance`: Emisión de recibos de cuotas, cobro de multas operativas y morosidad.
- `incident_tickets`: Reporte y seguimiento de averías de infraestructura.
- `announcements_board`: Avisos oficiales y votaciones de asamblea.
- `pet_registry`: Censo y control de vacunación de mascotas por departamento.

---

## 7. Interacción entre Servicios y Buenas Prácticas

1. **Aislamiento entre Dominios:** No realizar consultas SQL cruzadas directas entre tablas de diferentes módulos. Consumir la interfaz pública del servicio inyectado (`Service-to-Service`) pasando siempre el `TenantContext`.
2. **TypeScript Estricto:** Tipado exhaustivo en DTOs, entidades y respuestas. Prohibido el uso de `any`.
3. **Transacciones:** Operaciones compuestas (generación masiva de pisos/departamentos, préstamos, cobro de penalidades) deben ejecutarse de forma atómica.
4. **Estructura Modular en Frontend:** Organización por carpetas de dominio (`src/modules/{core, parking, carts, areas, settings}`) con componentes, hooks y llamadas sincronizadas con los servicios de InsForge.

---

## 8. Plan de Desarrollo por Sprints

### Sprint 0: Plataforma, InsForge Runtime, Multi-Tenancy y Configuración Modular (Prioridad: Crítica)
- Setup de esquemas en PostgreSQL gestionados por InsForge (`public` y dinámicos `condo_{slug}`).
- Autenticación centralizada JWT, propagación de `TenantContext` y enlace Frontend-Backend.
- Sistema de feature flags con `condo_settings` y middleware `@RequireModule`.
- Shell de navegación dinámica en React adaptado a módulos activos.

### Sprint 1: Estructura Física y Padrón de Residentes (`core_structure`) (Prioridad: Crítica)
- Modelos y migraciones de `towers`, `floors`, `departments` y `residents` (con campo `relationship_type`).
- Servicio transaccional `provisionTowerStructure()` para generación masiva en lote.
- Asistente (Wizard) de configuración inicial del condominio y gestión de residentes en React.

### Sprint 2: Préstamo de Carritos de Carga y Gestión de Multas (`cart_lending`) (Prioridad: Alta)
- Endpoints de checkout, check-in, detección de moras y cálculo paramétrico de penalidades.
- Panel de configuración para que el administrador defina tiempo máximo, período de gracia y monto de multa.
- Panel de garita para seguridad con visualización de tiempo restante y alerta de penalidad.
- Vista de residente para consulta de disponibilidad y cargos por mora asociados a su departamento.

### Sprint 3: Reserva de Áreas Comunes (`common_areas`) (Prioridad: Alta)
- Validación anti-solapamiento de horarios y reglas de aforo.
- Calendario interactivo de reservas en React.
- Panel de aprobación administrativa y agenda de eventos para seguridad.

### Sprint 4: Estacionamientos, Préstamos y Garita (`parking_control`) (Prioridad: Alta)
- Asignación de estacionamientos (`parking_spots` con estados DISPONIBLE/OCUPADO) y registro de vehículos por departamento.
- Flujo de préstamo/cesión de estacionamiento entre residentes con ventana de tiempo (`parking_loans` con estados PENDIENTE/ACTIVO/FINALIZADO/CANCELADO).
- Interfaz de garita para validación rápida de placas con `register-entry`/`register-exit`, registrando la puerta de ingreso y salida (`parking_access_logs.entry_gate_id` / `exit_gate_id`).
- **Sesión de puerta por agente (`guard_gate_sessions`):** el guardia selecciona su puerta una vez al autenticarse/entrar a garita; se usa por defecto en préstamos de carritos y registros de estacionamiento. Cambiable con confirmación.
- **Máquina de estado dentro/fuera:** un vehículo dentro solo puede salir; un vehículo fuera solo puede ingresar. Puede entrar por una puerta y salir por otra.
- Panel del residente/propietario para registrar sus vehículos, ver sus estacionamientos y prestarlas entre propietarios.
- Panel admin para gestionar estacionamientos, vehículos y préstamos (`ParkingManager` en pestaña "Estacionamiento" del SetupWizard y ruta `/parking`).

### Sprint 5: Módulos Complementarios Fase 2 (Prioridad: Media)
- Implementación progresiva de `visitor_access`, `billing_maintenance` (integrando la recaudación de multas de carritos), `incident_tickets`, `announcements_board` y `pet_registry`.
