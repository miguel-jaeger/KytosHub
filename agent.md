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
| **Visitante** | Esquema Local (Restringido) | Validación de accesos temporales y uso de bahías de visitas autorizadas. |

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

### 6.2. `parking_control` (Control de Estacionamientos y Préstamos - MVP)
- **Entidades:**
  - `parking_spots` (`id`, `spot_number`, `type` [PROPIO, VISITA, DISCAPACITADOS], `department_id` [nullable], `status` [DISPONIBLE, OCUPADO])
  - `vehicles` (`id`, `department_id`, `license_plate`, `brand`, `model`, `color`, `is_active`)
  - `parking_loans` (`id`, `spot_id`, `lender_department_id`, `borrower_department_id`, `borrower_vehicle_plate`, `start_time`, `end_time`, `status` [PENDIENTE, ACTIVO, FINALIZADO, CANCELADO])
  - `parking_access_logs` (`id`, `spot_id`, `license_plate`, `driver_name`, `entry_time`, `exit_time`, `authorized_by_user_id`, `guard_user_id`)
- **Reglas de Negocio:**
  - Los residentes gestionan y prestan sus bahías asignadas a otros residentes o visitantes autorizados con ventana de tiempo (`parking_loans`).
  - En garita, el agente valida la placa contra el propietario del espacio, préstamo activo vigente o disponibilidad de visitas.

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
- Asignación de bahías (`parking_spots` con estados DISPONIBLE/OCUPADO) y registro de vehículos por departamento.
- Flujo de préstamo/cesión de estacionamiento entre residentes con ventana de tiempo.
- Interfaz de garita para validación rápida de placas.

### Sprint 5: Módulos Complementarios Fase 2 (Prioridad: Media)
- Implementación progresiva de `visitor_access`, `billing_maintenance` (integrando la recaudación de multas de carritos), `incident_tickets`, `announcements_board` y `pet_registry`.
