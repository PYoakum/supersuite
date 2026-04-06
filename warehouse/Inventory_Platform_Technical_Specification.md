# Inventory Management Platform — Technical Specification

**Server-Based Inventory, Locationing, Barcode, and 3D Warehouse Visualization System**

Version 1.0 | March 2026 | Status: Draft

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Data Model](#3-data-model)
4. [API Specification](#4-api-specification)
5. [Web Interface](#5-web-interface)
6. [Three.js Visualization Design](#6-threejs-visualization-design)
7. [Barcode Subsystem](#7-barcode-subsystem)
8. [Identity and Access Control](#8-identity-and-access-control)
9. [Multi-Agent Development Workflow](#9-multi-agent-development-workflow)
10. [MVP Scope](#10-mvp-scope)
11. [Project Structure](#11-project-structure)
12. [Implementation Milestones](#12-implementation-milestones)
13. [Key Design Principles](#13-key-design-principles)

---

## 1. Executive Summary

This document defines the technical specification for a server-based inventory management platform. The system provides comprehensive item tracking, organization segmentation, warehouse locationing, barcode generation and scanning, and Three.js-powered 3D warehouse visualization.

The platform is designed for organizations that manage physical inventory across one or more warehouses and require precise location tracking down to the rack, shelf, and bin level, with the ability to visualize warehouse layouts in an interactive 3D environment.

### 1.1 Key Capabilities

- REST API and web-based user interface for all inventory operations
- Multi-organization and multi-warehouse segmentation with role-based access control
- Item creation, editing, tagging, and metadata management with photo support
- Hierarchical warehouse locationing: zone, aisle, rack, shelf, and bin
- 1D barcode generation (Code 128, Code 39, EAN-13, UPC-A) and scanner-based lookup
- Append-only inventory transaction log for transfers, adjustments, and audits
- Three.js warehouse scene rendering with orbital camera, object selection, and location highlighting

### 1.2 Document Scope

This specification covers the product requirements, system architecture, data model, API design, frontend page structure, 3D visualization design, barcode subsystem, multi-agent development workflow, and phased implementation plan. It serves as the primary reference for all engineering, QA, and documentation agents involved in building the platform.

---

## 2. System Architecture

### 2.1 Technology Stack

#### 2.1.1 Backend

| Component | Technology | Purpose |
| --- | --- | --- |
| Runtime | Node.js + TypeScript | Server execution environment |
| Framework | NestJS | Modular API framework with dependency injection |
| Database | PostgreSQL | Primary relational data store |
| ORM | Prisma | Type-safe database access and migrations |
| Cache / Queue Broker | Redis | Session caching, rate limiting, job queue backing |
| Job Queue | BullMQ | Background job processing (barcode generation, image thumbnails) |
| Object Storage | S3-compatible (MinIO / AWS S3) | Image and barcode image storage |

#### 2.1.2 Frontend

| Component | Technology | Purpose |
| --- | --- | --- |
| Framework | Next.js (App Router) | Server-side rendering and routing |
| UI Library | React | Component-based interface |
| Styling | Tailwind CSS | Utility-first CSS framework |
| Data Fetching | TanStack Query | Server state management and caching |
| Forms | React Hook Form + Zod | Form state management with schema validation |

#### 2.1.3 3D Visualization

| Component | Technology | Purpose |
| --- | --- | --- |
| Engine | Three.js | WebGL-based 3D rendering |
| React Integration | React Three Fiber | Declarative Three.js in React |
| Helpers | @react-three/drei | Orbital controls, labels, selection utilities |

#### 2.1.4 Barcode

| Component | Technology | Purpose |
| --- | --- | --- |
| Generation | bwip-js | Server-side 1D barcode image generation |
| Browser Scanning | Camera-based barcode library | Mobile and webcam barcode reading |
| USB Scanner | Focused input field pattern | Handheld scanner support via keyboard emulation |

### 2.2 High-Level Architecture

The platform follows a layered architecture with clear separation between the API layer, business logic, data access, and external services.

- **Client Layer:** Next.js web application served to browsers. Communicates with the API layer over HTTPS.
- **API Layer:** NestJS REST API handling authentication, authorization, request validation, and response formatting.
- **Service Layer:** Domain-specific business logic modules (Inventory, Location, Barcode, Scene, Search).
- **Data Layer:** Prisma ORM interfacing with PostgreSQL. Redis for caching and BullMQ job queues.
- **Storage Layer:** S3-compatible object storage for images and barcode files.

### 2.3 Deployment Topology

The recommended deployment uses containerized services orchestrated with Docker Compose for development and Kubernetes for production.

- API container: NestJS application with BullMQ worker processes
- Web container: Next.js application with server-side rendering
- Database container: PostgreSQL with persistent volume
- Cache container: Redis for sessions, caching, and job queues
- Object storage: MinIO (development) or AWS S3 (production)
- Reverse proxy: Nginx or cloud load balancer for TLS termination and routing

---

## 3. Data Model

The data model uses a normalized relational structure in PostgreSQL with Prisma as the ORM. All entities use UUID primary keys and include createdAt and updatedAt timestamps. Soft deletion is implemented via a deletedAt nullable timestamp column on entities that require historical reference retention.

### 3.1 Organization

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| id | UUID | PK, default gen | Unique identifier |
| name | VARCHAR(255) | NOT NULL | Organization display name |
| code | VARCHAR(50) | UNIQUE, NOT NULL | Short alphanumeric code |
| parentOrganizationId | UUID | FK nullable | Self-referential parent for hierarchy |
| deletedAt | TIMESTAMP | Nullable | Soft delete timestamp |
| createdAt | TIMESTAMP | NOT NULL, default now | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL, auto | Last update time |

### 3.2 Warehouse

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| id | UUID | PK, default gen | Unique identifier |
| organizationId | UUID | FK NOT NULL | Owning organization |
| name | VARCHAR(255) | NOT NULL | Warehouse display name |
| code | VARCHAR(50) | UNIQUE per org | Short reference code |
| address | TEXT | Nullable | Physical address |
| threeSceneConfig | JSONB | Nullable | 3D scene configuration blob |
| deletedAt | TIMESTAMP | Nullable | Soft delete timestamp |
| createdAt | TIMESTAMP | NOT NULL, default now | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL, auto | Last update time |

### 3.3 WarehouseZone

A dedicated entity for zones, providing a proper hierarchy between Warehouse and RackLocation rather than a flat text field.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| id | UUID | PK, default gen | Unique identifier |
| warehouseId | UUID | FK NOT NULL | Parent warehouse |
| name | VARCHAR(100) | NOT NULL | Zone display name (e.g., Zone A) |
| code | VARCHAR(20) | UNIQUE per warehouse | Short zone code |
| type | ENUM | NOT NULL | Type: storage, receiving, shipping, staging |
| createdAt | TIMESTAMP | NOT NULL, default now | Record creation time |

### 3.4 WarehouseGroup

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| id | UUID | PK, default gen | Unique identifier |
| warehouseId | UUID | FK NOT NULL | Parent warehouse |
| name | VARCHAR(255) | NOT NULL | Group display name |
| type | VARCHAR(50) | NOT NULL | Group classification |

### 3.5 RackLocation

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| id | UUID | PK, default gen | Unique identifier |
| warehouseId | UUID | FK NOT NULL | Parent warehouse |
| zoneId | UUID | FK NOT NULL | Parent zone |
| groupId | UUID | FK nullable | Optional warehouse group |
| aisle | VARCHAR(20) | NOT NULL | Aisle identifier |
| rack | VARCHAR(20) | NOT NULL | Rack identifier |
| shelf | VARCHAR(20) | NOT NULL | Shelf identifier |
| bin | VARCHAR(20) | Nullable | Bin identifier (optional) |
| label | VARCHAR(100) | UNIQUE per warehouse | Human-readable composite label |
| x | FLOAT | NOT NULL | 3D X coordinate |
| y | FLOAT | NOT NULL | 3D Y coordinate |
| z | FLOAT | NOT NULL | 3D Z coordinate |
| width | FLOAT | NOT NULL | Physical width (meters) |
| height | FLOAT | NOT NULL | Physical height (meters) |
| depth | FLOAT | NOT NULL | Physical depth (meters) |
| deletedAt | TIMESTAMP | Nullable | Soft delete timestamp |

### 3.6 Item

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| id | UUID | PK, default gen | Unique identifier |
| organizationId | UUID | FK NOT NULL | Owning organization |
| sku | VARCHAR(100) | UNIQUE per org | Stock keeping unit code |
| name | VARCHAR(255) | NOT NULL | Item display name |
| description | TEXT | Nullable | Extended description |
| thumbnailUrl | VARCHAR(500) | Nullable | Primary thumbnail image URL |
| quantity | INTEGER | NOT NULL, default 0 | Total quantity across all locations |
| unit | VARCHAR(50) | NOT NULL, default each | Unit of measure |
| condition | ENUM | NOT NULL, default new | Condition: new, used, refurbished, damaged |
| status | ENUM | NOT NULL, default active | Status: active, inactive, archived |
| metadataJson | JSONB | Nullable | Freeform metadata key-value pairs |
| deletedAt | TIMESTAMP | Nullable | Soft delete timestamp |
| createdAt | TIMESTAMP | NOT NULL, default now | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL, auto | Last update time |

### 3.7 ItemTag and ItemTagMap

Tags use a many-to-many junction table to support flexible categorization.

| Table | Column | Type | Description |
| --- | --- | --- | --- |
| ItemTag | id | UUID, PK | Unique identifier |
| ItemTag | name | VARCHAR(100), UNIQUE | Tag display name |
| ItemTag | type | VARCHAR(50) | Tag category (e.g., quality, category, custom) |
| ItemTagMap | itemId | UUID, FK | References Item |
| ItemTagMap | tagId | UUID, FK | References ItemTag |
| ItemTagMap | (itemId, tagId) | UNIQUE composite | Prevents duplicate mappings |

### 3.8 Barcode

Barcodes are stored separately from items to support multiple barcode records per item, including internal, supplier, and location barcodes.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| id | UUID | PK, default gen | Unique identifier |
| itemId | UUID | FK NOT NULL | Parent item |
| symbology | ENUM | NOT NULL | Code128, Code39, EAN13, UPCA |
| value | VARCHAR(255) | UNIQUE | Raw barcode value string |
| imageUrl | VARCHAR(500) | Nullable | URL to generated barcode image |
| type | ENUM | NOT NULL, default internal | Purpose: internal, supplier, location |
| createdAt | TIMESTAMP | NOT NULL, default now | Record creation time |

### 3.9 InventoryAssignment

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| id | UUID | PK, default gen | Unique identifier |
| itemId | UUID | FK NOT NULL | Assigned item |
| warehouseId | UUID | FK NOT NULL | Destination warehouse |
| rackLocationId | UUID | FK NOT NULL | Specific rack location |
| quantity | INTEGER | NOT NULL | Quantity at this location |
| placedAt | TIMESTAMP | NOT NULL, default now | Placement timestamp |

### 3.10 InventoryTransaction

The transaction log is append-only. Records are never updated or deleted. This provides a complete audit trail of all inventory movements.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| id | UUID | PK, default gen | Unique identifier |
| itemId | UUID | FK NOT NULL | Subject item |
| type | ENUM | NOT NULL | Type: check_in, check_out, transfer, adjustment |
| fromLocationId | UUID | FK nullable | Source rack location |
| toLocationId | UUID | FK nullable | Destination rack location |
| quantity | INTEGER | NOT NULL | Quantity moved or adjusted |
| actorUserId | UUID | FK NOT NULL | User who performed the action |
| note | TEXT | Nullable | Free-text note or reason |
| createdAt | TIMESTAMP | NOT NULL, default now | Transaction timestamp (immutable) |

### 3.11 ItemPhoto

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| id | UUID | PK, default gen | Unique identifier |
| itemId | UUID | FK NOT NULL | Parent item |
| url | VARCHAR(500) | NOT NULL | Full-size image URL |
| thumbnailUrl | VARCHAR(500) | Nullable | Generated thumbnail URL |
| altText | VARCHAR(255) | Nullable | Accessibility description |
| sortOrder | INTEGER | NOT NULL, default 0 | Display ordering |

### 3.12 User and Role

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| User.id | UUID | PK | Unique identifier |
| User.email | VARCHAR(255) | UNIQUE | Login email |
| User.name | VARCHAR(255) | NOT NULL | Display name |
| User.passwordHash | VARCHAR(255) | NOT NULL | Bcrypt hash |
| User.organizationId | UUID | FK NOT NULL | Primary organization |
| Role.id | UUID | PK | Unique identifier |
| Role.name | VARCHAR(100) | NOT NULL | Role name (admin, manager, operator, viewer) |
| UserRole.userId | UUID | FK | References User |
| UserRole.roleId | UUID | FK | References Role |
| UserRole.warehouseId | UUID | FK nullable | Optional warehouse-scoped permission |

### 3.13 Design Decisions

- **Dual location model:** Every RackLocation stores both human-readable path fields (zone, aisle, rack, shelf, bin) and 3D coordinates (x, y, z, width, height, depth) to support both text search and 3D rendering.
- **Separate Barcode entity:** Items may have multiple barcodes (internal, supplier, location) with different symbologies. Decoupling barcodes from items avoids schema rigidity.
- **Append-only transactions:** InventoryTransaction records are never updated or deleted, providing a tamper-resistant audit trail for compliance.
- **Soft deletes:** Organization, Warehouse, RackLocation, and Item include deletedAt columns to preserve referential integrity in historical records.
- **JSONB metadata:** Item.metadataJson allows freeform key-value pairs for domain-specific attributes without schema changes.
- **WarehouseZone entity:** A dedicated zone table (rather than a text field on RackLocation) enables proper hierarchical queries and clean 3D scene tree construction.

---

## 4. API Specification

The API follows RESTful conventions with JSON request and response bodies. All endpoints require authentication via JWT bearer token. Authorization is enforced per organization and optionally per warehouse based on user roles.

### 4.1 Inventory Endpoints

| Method | Path | Description |
| --- | --- | --- |
| POST | /api/items | Create a new item |
| GET | /api/items | List items (paginated, filterable) |
| GET | /api/items/:id | Get item detail with tags, photos, assignments |
| PATCH | /api/items/:id | Update item fields |
| DELETE | /api/items/:id | Soft-delete an item |

### 4.2 Tagging Endpoints

| Method | Path | Description |
| --- | --- | --- |
| POST | /api/tags | Create a new tag |
| GET | /api/tags | List all tags, optionally filtered by type |
| POST | /api/items/:id/tags | Attach one or more tags to an item |
| DELETE | /api/items/:id/tags/:tagId | Remove a tag from an item |

### 4.3 Barcode Endpoints

| Method | Path | Description |
| --- | --- | --- |
| POST | /api/items/:id/barcodes | Generate barcode for an item |
| GET | /api/items/:id/barcodes | List barcodes for an item |
| GET | /api/barcodes/:value | Look up item by barcode value |
| GET | /api/barcodes/:value/image | Retrieve barcode image (PNG) |

### 4.4 Location Endpoints

| Method | Path | Description |
| --- | --- | --- |
| POST | /api/warehouses | Create a warehouse |
| GET | /api/warehouses | List warehouses for current org |
| POST | /api/warehouses/:id/zones | Create a zone in a warehouse |
| POST | /api/warehouses/:id/groups | Create a group in a warehouse |
| POST | /api/rack-locations | Create a rack location |
| GET | /api/rack-locations | List locations (filterable by warehouse, zone) |
| GET | /api/rack-locations/:id | Get location detail with coordinates |
| PATCH | /api/rack-locations/:id | Update location fields or coordinates |

### 4.5 Assignment and Movement Endpoints

| Method | Path | Description |
| --- | --- | --- |
| POST | /api/items/:id/assignments | Assign item quantity to a rack location |
| POST | /api/items/:id/transfers | Transfer quantity between locations |
| POST | /api/items/:id/adjustments | Adjust quantity (gain/loss/correction) |
| GET | /api/items/:id/transactions | List transaction history for an item |

### 4.6 3D Scene Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | /api/warehouses/:id/scene | Retrieve 3D scene configuration |
| PUT | /api/warehouses/:id/scene | Update/replace 3D scene configuration |
| GET | /api/warehouses/:id/object-map | Get location-to-3D coordinate mappings |

### 4.7 Search Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | /api/search?q=... | Full-text search across items |
| GET | /api/search/barcode/:value | Resolve barcode to item and location |
| GET | /api/search/items?orgId=...&tag=...&warehouseId=... | Filtered item search |

### 4.8 Common API Patterns

- **Pagination:** Cursor-based using afterId and limit parameters. Default limit is 50, maximum is 200.
- **Filtering:** Query parameters for organization, warehouse, zone, tag, status, and condition.
- **Sorting:** sort and order query parameters (e.g., sort=createdAt&order=desc).
- **Error responses:** Standard JSON error body with statusCode, error, and message fields.
- **Validation:** Request bodies validated with Zod schemas. Invalid requests return 422 with field-level error details.

---

## 5. Web Interface

The frontend is a Next.js application organized into page groups corresponding to the core platform modules. All pages share a common layout with sidebar navigation, organization/warehouse context selector, and global search bar.

### 5.1 Page Map

#### 5.1.1 Administration Pages

- **Organizations:** List, create, and edit organizations with hierarchy management.
- **Warehouses:** List, create, and edit warehouses. Configure address and 3D scene settings.
- **Rack/Location Designer:** Visual interface for defining zones, aisles, racks, shelves, and bins with coordinate assignment.
- **Tags/Qualities Manager:** CRUD interface for tag definitions with type categorization.
- **Users and Roles:** User management with role assignment scoped to organization or warehouse level.

#### 5.1.2 Inventory Pages

- **Item List:** Paginated, filterable, and sortable table of all items in the current organization context.
- **Item Detail:** Comprehensive view with tabs for details, photos, barcodes, location assignments, and transaction history.
- **Create/Edit Item:** Form with fields for SKU, name, description, unit, condition, status, and metadata. Supports tag attachment and photo upload.
- **Upload Photo:** Drag-and-drop photo upload with automatic thumbnail generation. Reorderable gallery view.
- **Barcode Tab:** View, generate, and print barcodes for an item. Supports multiple symbologies.
- **Location Assignments:** View and manage which rack locations hold this item and in what quantities.
- **Transaction History:** Chronological, filterable log of all movements and adjustments for an item.

#### 5.1.3 Scanning Pages

- **Scan Item:** Camera-based or USB scanner input. Scans a barcode and immediately resolves to an item.
- **Instant Lookup:** After scan, displays item detail with current location and quick-action buttons.
- **Move Item After Scan:** Scan an item, then scan a destination location barcode to initiate a transfer.
- **Count Inventory By Scan:** Scan items sequentially to perform a stock count for a location or zone.

#### 5.1.4 Warehouse Visualization Pages

- **Warehouse Overview:** 2D location browser with zone, aisle, and rack hierarchy navigation.
- **3D Warehouse Scene:** Interactive Three.js viewer with rack, shelf, and bin meshes rendered from scene configuration.
- **Select Rack/Shelf/Bin:** Click-to-select interaction for inspecting contents of any storage unit.
- **Highlight Item Location:** Search for an item and the 3D view automatically flies the camera to its location with a visual highlight.
- **Inspect Contents:** Side panel showing all items assigned to the selected 3D unit with quantities and statuses.

---

## 6. Three.js Visualization Design

### 6.1 Scene Capabilities

- Warehouse floor plane rendered as a grid with zone boundaries indicated by color-coded regions.
- Racks, shelves, and bins rendered as parametric box meshes with dimensions derived from RackLocation records.
- Text labels anchored to 3D positions using drei HTML or Billboard components for zone, aisle, and rack identifiers.
- Item markers displayed as colored spheres or bounding box overlays at assigned locations.
- Click-to-select interaction on rack and bin meshes, triggering a side panel with contents detail.
- Orbit controls (rotate, pan, zoom) with configurable min/max distance and polar angle constraints.
- Zoom-to-location: Animated camera transition to a specific rack location, triggered by search or selection.
- Hover highlight: Visual feedback (emissive color change) when the cursor hovers over a selectable mesh.
- Search result highlight: When a barcode scan or text search returns results, all matching location meshes pulse with an accent color.

### 6.2 Location Mapping Strategy

Each RackLocation record stores both a human-readable hierarchical path and precise 3D spatial data. This dual representation enables text-based filtering and 3D rendering from the same data source.

- **Human-readable path:** Zone A > Aisle 3 > Rack 2 > Shelf 4 > Bin B (composed from zone, aisle, rack, shelf, bin fields).
- **3D coordinates:** x, y, z position plus width, height, depth dimensions, all stored in meters.

This allows the application to render physical positions in 3D, search by barcode or text, and fly the camera to the exact object location when a match is found.

### 6.3 Scene Data Structure

Warehouse 3D configurations are stored as JSONB in the Warehouse.threeSceneConfig column. The scene describes a tree of units, each with a type, position, size, and optional children.

- Top-level units represent racks or freestanding structures with absolute coordinates.
- Child units (shelves, bins) use coordinates relative to their parent.
- Each unit includes an id field that maps to a RackLocation.id for data binding.

The frontend scene renderer traverses this tree, creates Three.js meshes for each unit, and registers click/hover event handlers for interactivity. The object-map API endpoint provides a flat lookup from RackLocation IDs to 3D coordinates for search-driven highlighting.

---

## 7. Barcode Subsystem

### 7.1 Supported Symbologies

| Symbology | Use Case | Character Set |
| --- | --- | --- |
| Code 128 | Internal inventory labels (default) | Full ASCII |
| Code 39 | Legacy system compatibility | Alphanumeric + symbols |
| EAN-13 | Retail product identification | Numeric (13 digits) |
| UPC-A | Retail product identification (North America) | Numeric (12 digits) |

Code 128 is the recommended default for internal labels due to its compact encoding and full ASCII support.

### 7.2 Generation Flow

1. Item is created or a barcode generation is requested via the API.
2. The system generates an internal SKU-based barcode value if one is not provided.
3. A BullMQ job is enqueued to generate the barcode image using bwip-js.
4. The barcode image (PNG) is uploaded to S3-compatible storage.
5. The Barcode record is created with symbology, raw value, and image URL.
6. The item detail page reflects the new barcode upon completion.

### 7.3 Scanner Search Flow

1. User activates the scan page and scans a barcode using camera or handheld USB scanner.
2. The client sends the decoded value to `GET /api/search/barcode/:value`.
3. The API resolves the barcode value to an Item and its current InventoryAssignment records.
4. The UI displays the item detail view with current location assignments.
5. If the 3D warehouse viewer is active, the camera animates to the item's rack location with a highlight effect.

### 7.4 Scanner Input Handling

The platform supports two barcode input methods:

- **Camera scanning:** Uses a browser-based barcode detection library to decode barcodes from the device camera stream. Suitable for mobile devices and laptops with webcams.
- **USB handheld scanners:** These devices emulate keyboard input. A focused text input field on the scan page captures the barcode value followed by an Enter keystroke. This approach avoids camera permission issues and works reliably across all browsers.

---

## 8. Identity and Access Control

### 8.1 Authentication

Authentication uses JWT tokens issued upon successful email/password login. Tokens include the user ID, organization ID, and role claims. Refresh tokens enable session extension without re-authentication.

- **Access tokens:** Short-lived (15 minutes), included as Bearer token in Authorization header.
- **Refresh tokens:** Longer-lived (7 days), stored in HTTP-only secure cookies.
- **Password storage:** Bcrypt hashing with configurable work factor.

### 8.2 Authorization Model

Authorization is enforced at two levels: organization scope and optional warehouse scope.

| Role | Organization Scope | Warehouse Scope |
| --- | --- | --- |
| Admin | Full access to all resources in the org | N/A (implicitly all warehouses) |
| Manager | Read access to org resources | Full access to assigned warehouses |
| Operator | Read access to own items | CRUD on items and assignments in assigned warehouses |
| Viewer | Read-only access to org resources | Read-only access to assigned warehouses |

Every API request is validated against the user's roles and the requested resource's organization and warehouse context. Requests outside the user's permitted scope return 403 Forbidden.

---

## 9. Multi-Agent Development Workflow

The platform is built using a multi-agent LLM-driven development workflow. Each agent has a defined responsibility scope, input expectations, and output deliverables. An orchestrator coordinates the agents through a phased execution plan.

### 9.1 Agent Roles

| Agent | Responsibility | Primary Output |
| --- | --- | --- |
| Product Manager | Convert requirements into feature specs, user stories, and acceptance criteria | Product requirements, entity list, workflows |
| Solution Architect | Define architecture, API contracts, DB schema, auth model, deployment topology | Architecture docs, ERD, API spec, service boundaries |
| Backend Engineer | Implement NestJS API, DB schema, migrations, CRUD, barcode services, file upload | Server code, tests, OpenAPI spec |
| Frontend Engineer | Build Next.js UI: forms, tables, filters, search, scan page, dashboards | React components, routes, state/query hooks |
| 3D/Three.js Engineer | Build warehouse scene, unit primitives, camera controls, selection, highlighting | Scene editor/viewer, mesh components, locator behavior |
| QA Engineer | Write test plans, API tests, UI tests, scene interaction tests, regression | Automated tests, edge case reports |
| DevOps Engineer | Configure Docker, CI/CD, database provisioning, secrets, storage, observability | Deployment config, pipelines, monitoring setup |
| Documentation Writer | Produce README, admin guide, API docs, warehouse modeling guide, scanner guide | Documentation files |

### 9.2 Phased Execution

#### Phase 1: Planning

- Product Manager agent produces requirements and user stories from the project brief.
- Solution Architect agent converts requirements into technical design documents.
- Documentation Writer agent produces the implementation plan and project README.

#### Phase 2: Foundation

- Backend Engineer agent builds auth, organization, warehouse, item, and location modules.
- Frontend Engineer agent builds the base admin UI, navigation, and item CRUD pages.
- QA Engineer agent writes initial API and integration tests.

#### Phase 3: Barcode and Search

- Backend Engineer agent adds barcode generation, barcode lookup, and search endpoints.
- Frontend Engineer agent builds scan page, search interface, and barcode display components.
- QA Engineer agent validates scan workflows and barcode resolution paths.

#### Phase 4: 3D Warehouse

- 3D/Three.js Engineer agent builds the warehouse scene renderer, unit meshes, and camera controls.
- Backend Engineer agent adds scene configuration storage and object-map endpoints.
- Frontend Engineer agent links search results to 3D scene focus and selection panels.
- QA Engineer agent tests object selection, camera transitions, and location highlighting.

#### Phase 5: Hardening

- DevOps Engineer agent adds Docker configuration, CI/CD pipelines, and monitoring.
- Documentation Writer agent finalizes all guides and API documentation.
- QA Engineer agent runs end-to-end validation across all modules.

---

## 10. MVP Scope

### 10.1 Included in MVP

- Organization and warehouse CRUD with hierarchy support
- Rack/bin/shelf location management with zone, coordinate, and dimension fields
- Item CRUD with SKU, name, description, condition, status, and metadata
- Tag creation and item-tag assignment
- Photo upload with automatic thumbnail generation
- Code 128 barcode generation for items
- Barcode scanner search (camera and USB handheld)
- Inventory assignment of items to rack locations
- Transfer and adjustment operations with append-only transaction log
- Basic 3D warehouse viewer with rack/shelf/bin meshes
- Orbit camera controls (rotate, pan, zoom)
- Click-to-select on 3D units with contents side panel
- Search result highlighting in 3D view

### 10.2 Deferred to Future Phases

- Advanced demand forecasting and replenishment suggestions
- Procurement and purchase order management
- Supplier management and supplier barcode ingestion
- Robotics integration and automated pick-path optimization
- Real-time multi-user collaborative 3D scene editing
- Advanced analytics dashboards with historical trend visualization
- Mobile-native application (iOS/Android)

---

## 11. Project Structure

The codebase uses a monorepo layout with shared packages for types, configuration, and reusable modules.

| Path | Contents |
| --- | --- |
| apps/api/ | NestJS backend application |
| apps/web/ | Next.js frontend application |
| packages/types/ | Shared TypeScript type definitions and Zod schemas |
| packages/config/ | Shared configuration (environment, constants) |
| packages/ui/ | Shared React UI components |
| packages/three-scene/ | Three.js scene primitives and utilities |
| packages/barcode/ | Barcode generation utilities wrapping bwip-js |
| packages/db/ | Prisma schema, migrations, and seed scripts |
| infra/docker/ | Docker Compose and Dockerfile definitions |
| infra/k8s/ | Kubernetes manifests for production deployment |
| infra/terraform/ | Infrastructure-as-code for cloud provisioning |
| docs/requirements/ | Product requirements and user stories |
| docs/architecture/ | Architecture documents and ERD diagrams |
| docs/api/ | OpenAPI specification and API reference |

---

## 12. Implementation Milestones

### Milestone 1: Core Foundation

Authentication system, organization CRUD, warehouse CRUD, rack location management, and item CRUD. Establishes the relational backbone that all subsequent features depend on.

### Milestone 2: Metadata and Barcode

Tag management and item-tag mapping, photo upload with thumbnail generation, barcode generation using bwip-js, and barcode lookup search endpoint. Completes the item enrichment layer.

### Milestone 3: Tracking and Assignments

Inventory assignment of items to rack locations, transfer operations between locations, stock adjustment operations, append-only transaction log, and inventory dashboard views.

### Milestone 4: 3D Visualization

Three.js warehouse scene viewer with rack/shelf/bin meshes, object-map integration for location-to-coordinate binding, click-to-select and contents inspection panel, and search-triggered camera animation with location highlighting.

### Milestone 5: Production Readiness

3D scene editor for warehouse layout management, camera presets and saved view configurations, warehouse analytics and utilization metrics, Docker and Kubernetes deployment configurations, CI/CD pipelines, monitoring, and documentation finalization.

---

## 13. Key Design Principles

### 13.1 Dual Location Representation

Every storage location stores both structured text fields (zone, aisle, rack, shelf, bin) and 3D coordinates with dimensions. This enables efficient text-based search and filtering alongside accurate 3D rendering without data duplication or transformation.

### 13.2 Barcode-Item Separation

Barcodes are a separate entity from items because an item may require multiple barcodes: an internal label, a supplier barcode, and potentially a location barcode. Each barcode record stores its own symbology, raw value, and image reference.

### 13.3 Immutable Transaction Log

InventoryTransaction records are append-only and never modified after creation. This provides a complete, tamper-resistant audit trail of all inventory movements, adjustments, and transfers. Stock levels can be reconstructed from the transaction log at any point in time.

### 13.4 Thumbnails as Derived Data

Original uploaded images are stored in full resolution. Thumbnails are generated asynchronously via BullMQ background jobs and stored separately. If thumbnails need to be regenerated at different sizes, the originals remain available.

### 13.5 Scene Configuration as Data

Warehouse 3D geometry is not hardcoded in the frontend. Scene structures are persisted as JSONB in the database and served via API. This allows each warehouse to define its own physical layout without code changes, and supports a future scene editor for visual layout management.

### 13.6 Soft Deletion for Referential Integrity

Entities that participate in historical records (organizations, warehouses, locations, items) use soft deletion via a deletedAt timestamp. This prevents orphaned transaction records and maintains the ability to display historical data accurately.
