CREATE TABLE "memory_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"binding_key" text NOT NULL,
	"label" text NOT NULL,
	"provider_key" text NOT NULL,
	"plugin_id" uuid,
	"namespace" text DEFAULT 'memory' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "memory_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"binding_id" uuid NOT NULL,
	"operation_type" text NOT NULL,
	"status" text NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" text,
	"namespace" text DEFAULT 'memory' NOT NULL,
	"state_key" text,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"request" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_bindings" ADD CONSTRAINT "memory_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_bindings" ADD CONSTRAINT "memory_bindings_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_operations" ADD CONSTRAINT "memory_operations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_operations" ADD CONSTRAINT "memory_operations_binding_id_memory_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."memory_bindings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_bindings_company_idx" ON "memory_bindings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "memory_bindings_provider_idx" ON "memory_bindings" USING btree ("company_id","provider_key");--> statement-breakpoint
CREATE INDEX "memory_bindings_plugin_idx" ON "memory_bindings" USING btree ("plugin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_bindings_company_binding_key_uq" ON "memory_bindings" USING btree ("company_id","binding_key");--> statement-breakpoint
CREATE INDEX "memory_operations_company_idx" ON "memory_operations" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "memory_operations_binding_idx" ON "memory_operations" USING btree ("binding_id","created_at");--> statement-breakpoint
CREATE INDEX "memory_operations_scope_idx" ON "memory_operations" USING btree ("company_id","scope_kind","scope_id","created_at");--> statement-breakpoint
CREATE INDEX "memory_operations_status_idx" ON "memory_operations" USING btree ("status","created_at");