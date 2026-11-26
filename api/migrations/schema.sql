CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" (
    migration_id character varying(150) NOT NULL,
    product_version character varying(32) NOT NULL,
    CONSTRAINT pk___ef_migrations_history PRIMARY KEY (migration_id)
);

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119083021_InitialSchema') THEN
    CREATE TABLE equipment (
        id uuid NOT NULL,
        name character varying(200) NOT NULL,
        site character varying(200),
        created_at timestamp with time zone NOT NULL,
        CONSTRAINT pk_equipment PRIMARY KEY (id)
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119083021_InitialSchema') THEN
    CREATE TABLE uploads (
        id uuid NOT NULL,
        equipment_id uuid NOT NULL,
        original_name character varying(255) NOT NULL,
        stored_name character varying(100) NOT NULL,
        format character varying(50) NOT NULL,
        size_bytes bigint NOT NULL,
        sha256 character(64) NOT NULL,
        created_at timestamp with time zone NOT NULL,
        CONSTRAINT pk_uploads PRIMARY KEY (id),
        CONSTRAINT ck_uploads_format CHECK (format IN ('lbnl_simulated', 'lbnl_experimental')),
        CONSTRAINT ck_uploads_size_bytes CHECK (size_bytes > 0),
        CONSTRAINT fk_uploads_equipment_equipment_id FOREIGN KEY (equipment_id) REFERENCES equipment (id) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119083021_InitialSchema') THEN
    CREATE TABLE analyses (
        id uuid NOT NULL,
        upload_id uuid NOT NULL,
        equipment_id uuid NOT NULL,
        point_set character varying(20) NOT NULL,
        status character varying(20) NOT NULL,
        attempts integer NOT NULL,
        created_at timestamp with time zone NOT NULL,
        started_at timestamp with time zone,
        finished_at timestamp with time zone,
        worker_id character varying(200),
        traceparent character varying(55),
        error_code character varying(100),
        error_message character varying(1000),
        pipeline_version character varying(50),
        model_version character varying(200),
        hours_total integer,
        hours_scored integer,
        hours_alarmed integer,
        event_count integer,
        result jsonb,
        chart_series jsonb,
        CONSTRAINT pk_analyses PRIMARY KEY (id),
        CONSTRAINT ck_analyses_attempts CHECK (attempts >= 0),
        CONSTRAINT ck_analyses_point_set CHECK (point_set IN ('all', 'basic')),
        CONSTRAINT ck_analyses_status CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
        CONSTRAINT fk_analyses_equipment_equipment_id FOREIGN KEY (equipment_id) REFERENCES equipment (id) ON DELETE RESTRICT,
        CONSTRAINT fk_analyses_uploads_upload_id FOREIGN KEY (upload_id) REFERENCES uploads (id) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119083021_InitialSchema') THEN
    CREATE TABLE fault_events (
        id uuid NOT NULL,
        analysis_id uuid NOT NULL,
        equipment_id uuid NOT NULL,
        event_key character varying(50) NOT NULL,
        kind character varying(30) NOT NULL,
        fault character varying(100),
        starts_at timestamp with time zone NOT NULL,
        ends_at timestamp with time zone NOT NULL,
        hours integer NOT NULL,
        confidence double precision,
        detector_score double precision NOT NULL,
        CONSTRAINT pk_fault_events PRIMARY KEY (id),
        CONSTRAINT ck_fault_events_hours CHECK (hours > 0),
        CONSTRAINT ck_fault_events_kind CHECK (kind IN ('fault', 'inconclusive', 'no_supported_fault', 'not_diagnosable')),
        CONSTRAINT ck_fault_events_span CHECK (ends_at > starts_at),
        CONSTRAINT fk_fault_events_analyses_analysis_id FOREIGN KEY (analysis_id) REFERENCES analyses (id) ON DELETE CASCADE,
        CONSTRAINT fk_fault_events_equipment_equipment_id FOREIGN KEY (equipment_id) REFERENCES equipment (id) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119083021_InitialSchema') THEN
    CREATE INDEX ix_analyses_equipment_id_created_at ON analyses (equipment_id, created_at);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119083021_InitialSchema') THEN
    CREATE INDEX ix_analyses_status_created_at ON analyses (status, created_at);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119083021_InitialSchema') THEN
    CREATE INDEX ix_analyses_upload_id ON analyses (upload_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119083021_InitialSchema') THEN
    CREATE INDEX ix_equipment_site ON equipment (site);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119083021_InitialSchema') THEN
    CREATE UNIQUE INDEX ix_fault_events_analysis_id_event_key ON fault_events (analysis_id, event_key);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119083021_InitialSchema') THEN
    CREATE INDEX ix_fault_events_equipment_id_starts_at ON fault_events (equipment_id, starts_at);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119083021_InitialSchema') THEN
    CREATE INDEX ix_fault_events_fault_starts_at ON fault_events (fault, starts_at);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119083021_InitialSchema') THEN
    CREATE INDEX ix_uploads_equipment_id ON uploads (equipment_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119083021_InitialSchema') THEN
    CREATE INDEX ix_uploads_sha256 ON uploads (sha256);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119083021_InitialSchema') THEN
    CREATE UNIQUE INDEX ix_uploads_stored_name ON uploads (stored_name);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119083021_InitialSchema') THEN
    INSERT INTO "__EFMigrationsHistory" (migration_id, product_version)
    VALUES ('20261119083021_InitialSchema', '10.0.14');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119092408_AddFaultEventReview') THEN
    ALTER TABLE fault_events ADD review_note character varying(1000);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119092408_AddFaultEventReview') THEN
    ALTER TABLE fault_events ADD review_status character varying(20) NOT NULL DEFAULT 'unreviewed';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119092408_AddFaultEventReview') THEN
    ALTER TABLE fault_events ADD reviewed_at timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119092408_AddFaultEventReview') THEN
    ALTER TABLE fault_events ADD CONSTRAINT ck_fault_events_review_status CHECK (review_status IN ('unreviewed', 'needs_review', 'confirmed', 'rejected'));
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261119092408_AddFaultEventReview') THEN
    INSERT INTO "__EFMigrationsHistory" (migration_id, product_version)
    VALUES ('20261119092408_AddFaultEventReview', '10.0.14');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261126014155_AddProcessingReport') THEN
    ALTER TABLE analyses ADD processing_report jsonb;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261126014155_AddProcessingReport') THEN
    INSERT INTO "__EFMigrationsHistory" (migration_id, product_version)
    VALUES ('20261126014155_AddProcessingReport', '10.0.14');
    END IF;
END $EF$;
COMMIT;

