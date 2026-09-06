export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      audit_assets: {
        Row: {
          audit_task_id: string
          checksum_sha256: string
          created_at: string
          extract_status: Database["public"]["Enums"]["asset_extract_status"]
          extracted_text: string | null
          extraction_confidence: number | null
          file_name: string
          id: string
          mime_type: string
          size_bytes: number
          sort_order: number
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          audit_task_id: string
          checksum_sha256: string
          created_at?: string
          extract_status?: Database["public"]["Enums"]["asset_extract_status"]
          extracted_text?: string | null
          extraction_confidence?: number | null
          file_name: string
          id?: string
          mime_type: string
          size_bytes: number
          sort_order: number
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          audit_task_id?: string
          checksum_sha256?: string
          created_at?: string
          extract_status?: Database["public"]["Enums"]["asset_extract_status"]
          extracted_text?: string | null
          extraction_confidence?: number | null
          file_name?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          sort_order?: number
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_assets_audit_task_id_user_id_fkey"
            columns: ["audit_task_id", "user_id"]
            isOneToOne: false
            referencedRelation: "audit_tasks"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      audit_coverage_warnings: {
        Row: {
          asset_id: string | null
          audit_task_id: string
          code: string
          created_at: string
          id: string
          location: string | null
          message: string
          user_id: string
        }
        Insert: {
          asset_id?: string | null
          audit_task_id: string
          code: string
          created_at?: string
          id?: string
          location?: string | null
          message: string
          user_id: string
        }
        Update: {
          asset_id?: string | null
          audit_task_id?: string
          code?: string
          created_at?: string
          id?: string
          location?: string | null
          message?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_coverage_warnings_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "audit_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_coverage_warnings_audit_task_id_user_id_fkey"
            columns: ["audit_task_id", "user_id"]
            isOneToOne: false
            referencedRelation: "audit_tasks"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      audit_findings: {
        Row: {
          audit_task_id: string
          category: string
          chunk_id: string
          confidence: number
          created_at: string
          document_id: string
          document_version: number
          explanation: string
          id: string
          knowledge_base_id: string
          knowledge_base_version: number
          location: Json
          risk_level: Database["public"]["Enums"]["risk_level"]
          source_document: string
          source_excerpt: string
          source_locator: string
          source_scope: Database["public"]["Enums"]["knowledge_base_scope"]
          source_url: string | null
          suggestion: string
          user_id: string
        }
        Insert: {
          audit_task_id: string
          category: string
          chunk_id: string
          confidence: number
          created_at?: string
          document_id: string
          document_version: number
          explanation: string
          id?: string
          knowledge_base_id: string
          knowledge_base_version: number
          location: Json
          risk_level: Database["public"]["Enums"]["risk_level"]
          source_document: string
          source_excerpt: string
          source_locator: string
          source_scope: Database["public"]["Enums"]["knowledge_base_scope"]
          source_url?: string | null
          suggestion: string
          user_id: string
        }
        Update: {
          audit_task_id?: string
          category?: string
          chunk_id?: string
          confidence?: number
          created_at?: string
          document_id?: string
          document_version?: number
          explanation?: string
          id?: string
          knowledge_base_id?: string
          knowledge_base_version?: number
          location?: Json
          risk_level?: Database["public"]["Enums"]["risk_level"]
          source_document?: string
          source_excerpt?: string
          source_locator?: string
          source_scope?: Database["public"]["Enums"]["knowledge_base_scope"]
          source_url?: string | null
          suggestion?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_findings_audit_task_id_user_id_fkey"
            columns: ["audit_task_id", "user_id"]
            isOneToOne: false
            referencedRelation: "audit_tasks"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      audit_knowledge_snapshots: {
        Row: {
          audit_task_id: string
          created_at: string
          document_versions: Json
          id: string
          knowledge_base_id: string
          knowledge_base_version: number
          name: string
          scope: Database["public"]["Enums"]["knowledge_base_scope"]
          user_id: string
        }
        Insert: {
          audit_task_id: string
          created_at?: string
          document_versions?: Json
          id?: string
          knowledge_base_id: string
          knowledge_base_version: number
          name: string
          scope: Database["public"]["Enums"]["knowledge_base_scope"]
          user_id: string
        }
        Update: {
          audit_task_id?: string
          created_at?: string
          document_versions?: Json
          id?: string
          knowledge_base_id?: string
          knowledge_base_version?: number
          name?: string
          scope?: Database["public"]["Enums"]["knowledge_base_scope"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_knowledge_snapshots_audit_task_id_user_id_fkey"
            columns: ["audit_task_id", "user_id"]
            isOneToOne: false
            referencedRelation: "audit_tasks"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      audit_tasks: {
        Row: {
          body: string
          completed_at: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          idempotency_key: string
          message_code: string | null
          overall_risk: Database["public"]["Enums"]["risk_level"] | null
          parent_audit_task_id: string | null
          private_knowledge_base_ids: string[]
          progress: number
          recommended_action: string | null
          requirements: string | null
          result_schema_version: string | null
          risk_counts: Json | null
          status: Database["public"]["Enums"]["audit_status"]
          submitted_at: string | null
          task_id: string | null
          task_name: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key: string
          message_code?: string | null
          overall_risk?: Database["public"]["Enums"]["risk_level"] | null
          parent_audit_task_id?: string | null
          private_knowledge_base_ids?: string[]
          progress?: number
          recommended_action?: string | null
          requirements?: string | null
          result_schema_version?: string | null
          risk_counts?: Json | null
          status?: Database["public"]["Enums"]["audit_status"]
          submitted_at?: string | null
          task_id?: string | null
          task_name?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string
          message_code?: string | null
          overall_risk?: Database["public"]["Enums"]["risk_level"] | null
          parent_audit_task_id?: string | null
          private_knowledge_base_ids?: string[]
          progress?: number
          recommended_action?: string | null
          requirements?: string | null
          result_schema_version?: string | null
          risk_counts?: Json | null
          status?: Database["public"]["Enums"]["audit_status"]
          submitted_at?: string | null
          task_id?: string | null
          task_name?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_tasks_parent_owner_fk"
            columns: ["parent_audit_task_id", "user_id"]
            isOneToOne: false
            referencedRelation: "audit_tasks"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      creator_evidence: {
        Row: {
          captured_at: string
          confidence: number | null
          created_at: string
          evidence_type: string
          excerpt: string
          id: string
          project_creator_id: string
          source_url: string | null
          user_id: string
        }
        Insert: {
          captured_at: string
          confidence?: number | null
          created_at?: string
          evidence_type: string
          excerpt: string
          id?: string
          project_creator_id: string
          source_url?: string | null
          user_id: string
        }
        Update: {
          captured_at?: string
          confidence?: number | null
          created_at?: string
          evidence_type?: string
          excerpt?: string
          id?: string
          project_creator_id?: string
          source_url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creator_evidence_project_creator_id_user_id_fkey"
            columns: ["project_creator_id", "user_id"]
            isOneToOne: false
            referencedRelation: "project_creators"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      creator_tags: {
        Row: {
          created_at: string
          id: string
          project_creator_id: string
          tag: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_creator_id: string
          tag: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_creator_id?: string
          tag?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creator_tags_project_creator_id_user_id_fkey"
            columns: ["project_creator_id", "user_id"]
            isOneToOne: false
            referencedRelation: "project_creators"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      creators: {
        Row: {
          avatar_url: string | null
          created_at: string
          handle: string | null
          id: string
          latest_captured_at: string | null
          latest_snapshot: Json
          nickname: string
          platform: Database["public"]["Enums"]["platform_kind"]
          platform_creator_id: string
          profile_url: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          handle?: string | null
          id?: string
          latest_captured_at?: string | null
          latest_snapshot?: Json
          nickname: string
          platform?: Database["public"]["Enums"]["platform_kind"]
          platform_creator_id: string
          profile_url: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          handle?: string | null
          id?: string
          latest_captured_at?: string | null
          latest_snapshot?: Json
          nickname?: string
          platform?: Database["public"]["Enums"]["platform_kind"]
          platform_creator_id?: string
          profile_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      knowledge_bases: {
        Row: {
          created_at: string
          description: string | null
          document_count: number
          effective_at: string | null
          id: string
          name: string
          ready_document_count: number
          scope: Database["public"]["Enums"]["knowledge_base_scope"]
          selectable: boolean
          source_url: string | null
          status: Database["public"]["Enums"]["knowledge_base_status"]
          updated_at: string
          user_id: string | null
          version: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          document_count?: number
          effective_at?: string | null
          id?: string
          name: string
          ready_document_count?: number
          scope: Database["public"]["Enums"]["knowledge_base_scope"]
          selectable?: boolean
          source_url?: string | null
          status?: Database["public"]["Enums"]["knowledge_base_status"]
          updated_at?: string
          user_id?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          document_count?: number
          effective_at?: string | null
          id?: string
          name?: string
          ready_document_count?: number
          scope?: Database["public"]["Enums"]["knowledge_base_scope"]
          selectable?: boolean
          source_url?: string | null
          status?: Database["public"]["Enums"]["knowledge_base_status"]
          updated_at?: string
          user_id?: string | null
          version?: number
        }
        Relationships: []
      }
      knowledge_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          document_version: number
          embedding: string | null
          id: string
          knowledge_base_id: string
          metadata: Json
          source_locator: string
          user_id: string | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          document_version: number
          embedding?: string | null
          id?: string
          knowledge_base_id: string
          metadata?: Json
          source_locator: string
          user_id?: string | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          document_version?: number
          embedding?: string | null
          id?: string
          knowledge_base_id?: string
          metadata?: Json
          source_locator?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_chunks_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          checksum_sha256: string
          chunk_count: number | null
          created_at: string
          error_code: string | null
          file_name: string
          id: string
          knowledge_base_id: string
          message_code: string | null
          mime_type: string
          page_count: number | null
          size_bytes: number
          status: Database["public"]["Enums"]["knowledge_document_status"]
          storage_path: string
          task_id: string | null
          updated_at: string
          user_id: string | null
          version: number
        }
        Insert: {
          checksum_sha256: string
          chunk_count?: number | null
          created_at?: string
          error_code?: string | null
          file_name: string
          id?: string
          knowledge_base_id: string
          message_code?: string | null
          mime_type: string
          page_count?: number | null
          size_bytes: number
          status?: Database["public"]["Enums"]["knowledge_document_status"]
          storage_path: string
          task_id?: string | null
          updated_at?: string
          user_id?: string | null
          version?: number
        }
        Update: {
          checksum_sha256?: string
          chunk_count?: number | null
          created_at?: string
          error_code?: string | null
          file_name?: string
          id?: string
          knowledge_base_id?: string
          message_code?: string | null
          mime_type?: string
          page_count?: number | null
          size_bytes?: number
          status?: Database["public"]["Enums"]["knowledge_document_status"]
          storage_path?: string
          task_id?: string | null
          updated_at?: string
          user_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_documents_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_sessions: {
        Row: {
          account_display_name: string | null
          account_handle_masked: string | null
          created_at: string
          encrypted_state: string | null
          encrypted_state_nonce: string | null
          encrypted_state_tag: string | null
          id: string
          last_verified_at: string | null
          message_code: string | null
          platform: Database["public"]["Enums"]["platform_kind"]
          qr_expires_at: string | null
          qr_storage_path: string | null
          session_expires_at: string | null
          status: Database["public"]["Enums"]["platform_connection_status"]
          task_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_display_name?: string | null
          account_handle_masked?: string | null
          created_at?: string
          encrypted_state?: string | null
          encrypted_state_nonce?: string | null
          encrypted_state_tag?: string | null
          id?: string
          last_verified_at?: string | null
          message_code?: string | null
          platform?: Database["public"]["Enums"]["platform_kind"]
          qr_expires_at?: string | null
          qr_storage_path?: string | null
          session_expires_at?: string | null
          status?: Database["public"]["Enums"]["platform_connection_status"]
          task_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_display_name?: string | null
          account_handle_masked?: string | null
          created_at?: string
          encrypted_state?: string | null
          encrypted_state_nonce?: string | null
          encrypted_state_tag?: string | null
          id?: string
          last_verified_at?: string | null
          message_code?: string | null
          platform?: Database["public"]["Enums"]["platform_kind"]
          qr_expires_at?: string | null
          qr_storage_path?: string | null
          session_expires_at?: string | null
          status?: Database["public"]["Enums"]["platform_connection_status"]
          task_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_creators: {
        Row: {
          activity_score: number | null
          analysis_json: Json
          captured_at: string
          contact_status: Database["public"]["Enums"]["contact_status"]
          created_at: string
          creator_id: string
          data_completeness: string
          decision_status: Database["public"]["Enums"]["creator_decision_status"]
          discard_reason: string | null
          evidence_summary: string
          field_warnings: Json
          followers: number | null
          group_id: string | null
          id: string
          last_post_at: string | null
          match_score: number | null
          median_engagement: number | null
          posts_last_30d: number | null
          project_id: string
          search_task_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          activity_score?: number | null
          analysis_json?: Json
          captured_at: string
          contact_status?: Database["public"]["Enums"]["contact_status"]
          created_at?: string
          creator_id: string
          data_completeness?: string
          decision_status?: Database["public"]["Enums"]["creator_decision_status"]
          discard_reason?: string | null
          evidence_summary?: string
          field_warnings?: Json
          followers?: number | null
          group_id?: string | null
          id?: string
          last_post_at?: string | null
          match_score?: number | null
          median_engagement?: number | null
          posts_last_30d?: number | null
          project_id: string
          search_task_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          activity_score?: number | null
          analysis_json?: Json
          captured_at?: string
          contact_status?: Database["public"]["Enums"]["contact_status"]
          created_at?: string
          creator_id?: string
          data_completeness?: string
          decision_status?: Database["public"]["Enums"]["creator_decision_status"]
          discard_reason?: string | null
          evidence_summary?: string
          field_warnings?: Json
          followers?: number | null
          group_id?: string | null
          id?: string
          last_post_at?: string | null
          match_score?: number | null
          median_engagement?: number | null
          posts_last_30d?: number | null
          project_id?: string
          search_task_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_creators_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_creators_group_id_project_id_user_id_fkey"
            columns: ["group_id", "project_id", "user_id"]
            isOneToOne: false
            referencedRelation: "project_groups"
            referencedColumns: ["id", "project_id", "user_id"]
          },
          {
            foreignKeyName: "project_creators_project_id_user_id_fkey"
            columns: ["project_id", "user_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "project_creators_search_task_id_project_id_user_id_fkey"
            columns: ["search_task_id", "project_id", "user_id"]
            isOneToOne: false
            referencedRelation: "search_tasks"
            referencedColumns: ["id", "project_id", "user_id"]
          },
        ]
      }
      project_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_groups_project_id_user_id_fkey"
            columns: ["project_id", "user_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          id: string
          idempotency_key: string
          name: string
          product_name: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          idempotency_key: string
          name: string
          product_name: string
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          idempotency_key?: string
          name?: string
          product_name?: string
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      search_tasks: {
        Row: {
          can_continue: boolean
          collected_count: number
          completed_at: string | null
          confirmed_rule: Json
          created_at: string
          duplicate_count: number
          stage_counts: Json
          error_code: string | null
          error_message: string | null
          id: string
          idempotency_key: string
          loop_state: Json
          message_code: string | null
          model_version: string | null
          partial_reason:
            | Database["public"]["Enums"]["search_partial_reason"]
            | null
          persisted_count: number
          progress: number
          project_id: string
          prompt_version: string | null
          query_text: string
          retry_after_seconds: number | null
          rule_schema_version: string
          started_at: string | null
          status: Database["public"]["Enums"]["search_task_status"]
          target_count: number
          task_id: string
          terminal: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          can_continue?: boolean
          collected_count?: number
          completed_at?: string | null
          confirmed_rule: Json
          created_at?: string
          duplicate_count?: number
          stage_counts?: Json
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key: string
          loop_state?: Json
          message_code?: string | null
          model_version?: string | null
          partial_reason?:
            | Database["public"]["Enums"]["search_partial_reason"]
            | null
          persisted_count?: number
          progress?: number
          project_id: string
          prompt_version?: string | null
          query_text: string
          retry_after_seconds?: number | null
          rule_schema_version?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["search_task_status"]
          target_count?: number
          task_id: string
          terminal?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          can_continue?: boolean
          collected_count?: number
          completed_at?: string | null
          confirmed_rule?: Json
          created_at?: string
          duplicate_count?: number
          stage_counts?: Json
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string
          loop_state?: Json
          message_code?: string | null
          model_version?: string | null
          partial_reason?:
            | Database["public"]["Enums"]["search_partial_reason"]
            | null
          persisted_count?: number
          progress?: number
          project_id?: string
          prompt_version?: string | null
          query_text?: string
          retry_after_seconds?: number | null
          rule_schema_version?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["search_task_status"]
          target_count?: number
          task_id?: string
          terminal?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_tasks_project_id_user_id_fkey"
            columns: ["project_id", "user_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          created_at: string
          display_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_upload_to_storage: {
        Args: { p_bucket_id: string; p_object_name: string }
        Returns: boolean
      }
    }
    Enums: {
      asset_extract_status:
        | "pending"
        | "extracting"
        | "ready"
        | "low_confidence"
        | "failed"
      audit_status:
        | "draft"
        | "queued"
        | "validating"
        | "extracting"
        | "retrieving"
        | "analyzing"
        | "validating_result"
        | "completed"
        | "needs_attention"
        | "cancelled"
        | "failed"
      contact_status:
        | "not_contacted"
        | "contacting"
        | "cooperated"
        | "unreachable"
      creator_decision_status: "pending" | "selected" | "discarded"
      knowledge_base_scope: "public_law" | "private"
      knowledge_base_status:
        | "empty"
        | "processing"
        | "ready"
        | "needs_attention"
        | "failed"
      knowledge_document_status:
        | "uploaded"
        | "parsing"
        | "chunking"
        | "embedding"
        | "validating"
        | "ready"
        | "needs_attention"
        | "cancelled"
        | "failed"
      platform_connection_status:
        | "disconnected"
        | "qr_pending"
        | "qr_scanned"
        | "connected"
        | "expired"
        | "restricted"
        | "failed"
      platform_kind: "xiaohongshu" | "douyin"
      project_status: "active" | "archived"
      risk_level: "low" | "medium" | "high" | "needs_confirmation"
      search_partial_reason:
        | "source_exhausted"
        | "session_expired"
        | "platform_rate_limited"
        | "platform_restricted"
        | "user_cancelled"
        | "upstream_error"
         | "execution_timeout"
         | "loop_limit"
      search_task_status:
        | "queued"
        | "validating_session"
        | "collecting"
        | "hard_filtering"
        | "analyzing"
        | "persisting"
        | "completed"
        | "partial"
        | "cancelled"
        | "session_expired"
        | "rate_limited"
        | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      asset_extract_status: [
        "pending",
        "extracting",
        "ready",
        "low_confidence",
        "failed",
      ],
      audit_status: [
        "draft",
        "queued",
        "validating",
        "extracting",
        "retrieving",
        "analyzing",
        "validating_result",
        "completed",
        "needs_attention",
        "cancelled",
        "failed",
      ],
      contact_status: [
        "not_contacted",
        "contacting",
        "cooperated",
        "unreachable",
      ],
      creator_decision_status: ["pending", "selected", "discarded"],
      knowledge_base_scope: ["public_law", "private"],
      knowledge_base_status: [
        "empty",
        "processing",
        "ready",
        "needs_attention",
        "failed",
      ],
      knowledge_document_status: [
        "uploaded",
        "parsing",
        "chunking",
        "embedding",
        "validating",
        "ready",
        "needs_attention",
        "cancelled",
        "failed",
      ],
      platform_connection_status: [
        "disconnected",
        "qr_pending",
        "qr_scanned",
        "connected",
        "expired",
        "restricted",
        "failed",
      ],
      platform_kind: ["xiaohongshu"],
      project_status: ["active", "archived"],
      risk_level: ["low", "medium", "high", "needs_confirmation"],
      search_partial_reason: [
        "source_exhausted",
        "session_expired",
        "platform_rate_limited",
        "platform_restricted",
        "user_cancelled",
        "upstream_error",
        "execution_timeout",
        "loop_limit",
      ],
      search_task_status: [
        "queued",
        "validating_session",
        "collecting",
        "hard_filtering",
        "analyzing",
        "persisting",
        "completed",
        "partial",
        "cancelled",
        "session_expired",
        "rate_limited",
        "failed",
      ],
    },
  },
} as const
