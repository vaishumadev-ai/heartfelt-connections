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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          reason: string | null
          subject_id: string | null
          target_id: string | null
          target_kind: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          reason?: string | null
          subject_id?: string | null
          target_id?: string | null
          target_kind?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          reason?: string | null
          subject_id?: string | null
          target_id?: string | null
          target_kind?: string | null
        }
        Relationships: []
      }
      certificates: {
        Row: {
          certificate_number: string
          course_id: string
          course_title_snapshot: string
          id: string
          instructor_name_snapshot: string
          issued_at: string
          learner_name_snapshot: string
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          user_id: string
          verification_code: string
        }
        Insert: {
          certificate_number: string
          course_id: string
          course_title_snapshot: string
          id?: string
          instructor_name_snapshot: string
          issued_at?: string
          learner_name_snapshot: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          user_id: string
          verification_code?: string
        }
        Update: {
          certificate_number?: string
          course_id?: string
          course_title_snapshot?: string
          id?: string
          instructor_name_snapshot?: string
          issued_at?: string
          learner_name_snapshot?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          user_id?: string
          verification_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "certificates_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          audience: string[]
          category: string
          certificate: boolean
          cover_storage_path: string | null
          cover_url: string | null
          created_at: string
          description: string | null
          duration_label: string | null
          faq: Json
          icon_kind: string | null
          id: string
          instructor_bio: string | null
          instructor_id: string | null
          instructor_name: string | null
          instructor_title: string | null
          is_published: boolean
          language: string
          learn_outcomes: string[]
          level: string
          likes: number
          price_cents: number
          rating: number
          requirements: string[]
          review_decided_at: string | null
          review_decided_by: string | null
          review_decision_reason: string | null
          review_status: Database["public"]["Enums"]["course_review_status"]
          skills: string[]
          slug: string
          students_count: number
          submitted_at: string | null
          subtitle: string | null
          title: string
          updated_at: string
        }
        Insert: {
          audience?: string[]
          category: string
          certificate?: boolean
          cover_storage_path?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          duration_label?: string | null
          faq?: Json
          icon_kind?: string | null
          id?: string
          instructor_bio?: string | null
          instructor_id?: string | null
          instructor_name?: string | null
          instructor_title?: string | null
          is_published?: boolean
          language?: string
          learn_outcomes?: string[]
          level?: string
          likes?: number
          price_cents?: number
          rating?: number
          requirements?: string[]
          review_decided_at?: string | null
          review_decided_by?: string | null
          review_decision_reason?: string | null
          review_status?: Database["public"]["Enums"]["course_review_status"]
          skills?: string[]
          slug: string
          students_count?: number
          submitted_at?: string | null
          subtitle?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          audience?: string[]
          category?: string
          certificate?: boolean
          cover_storage_path?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          duration_label?: string | null
          faq?: Json
          icon_kind?: string | null
          id?: string
          instructor_bio?: string | null
          instructor_id?: string | null
          instructor_name?: string | null
          instructor_title?: string | null
          is_published?: boolean
          language?: string
          learn_outcomes?: string[]
          level?: string
          likes?: number
          price_cents?: number
          rating?: number
          requirements?: string[]
          review_decided_at?: string | null
          review_decided_by?: string | null
          review_decision_reason?: string | null
          review_status?: Database["public"]["Enums"]["course_review_status"]
          skills?: string[]
          slug?: string
          students_count?: number
          submitted_at?: string | null
          subtitle?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      enrollments: {
        Row: {
          course_id: string
          enrolled_at: string
          id: string
          last_activity_at: string
          last_lesson_id: string | null
          progress: number
          user_id: string
        }
        Insert: {
          course_id: string
          enrolled_at?: string
          id?: string
          last_activity_at?: string
          last_lesson_id?: string | null
          progress?: number
          user_id: string
        }
        Update: {
          course_id?: string
          enrolled_at?: string
          id?: string
          last_activity_at?: string
          last_lesson_id?: string | null
          progress?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_last_lesson_id_fkey"
            columns: ["last_lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      instructor_applications: {
        Row: {
          application_reason: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          id: string
          status: Database["public"]["Enums"]["instructor_application_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          application_reason?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          id?: string
          status?: Database["public"]["Enums"]["instructor_application_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          application_reason?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          id?: string
          status?: Database["public"]["Enums"]["instructor_application_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      lesson_bookmarks: {
        Row: {
          course_id: string
          created_at: string
          id: string
          lesson_id: string
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          lesson_id: string
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          lesson_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_bookmarks_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_bookmarks_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_completions: {
        Row: {
          completed_at: string
          course_id: string
          id: string
          lesson_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          course_id: string
          id?: string
          lesson_id: string
          user_id: string
        }
        Update: {
          completed_at?: string
          course_id?: string
          id?: string
          lesson_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_completions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_completions_lesson_course_fkey"
            columns: ["lesson_id", "course_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id", "course_id"]
          },
        ]
      }
      lesson_notes: {
        Row: {
          body: string
          course_id: string
          created_at: string
          id: string
          lesson_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          course_id: string
          created_at?: string
          id?: string
          lesson_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          course_id?: string
          created_at?: string
          id?: string
          lesson_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_notes_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_notes_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          content: string | null
          course_id: string
          created_at: string
          duration_seconds: number | null
          id: string
          is_preview: boolean
          module_title: string | null
          position: number
          title: string
          video_storage_path: string | null
          video_url: string | null
        }
        Insert: {
          content?: string | null
          course_id: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          is_preview?: boolean
          module_title?: string | null
          position: number
          title: string
          video_storage_path?: string | null
          video_url?: string | null
        }
        Update: {
          content?: string | null
          course_id?: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          is_preview?: boolean
          module_title?: string | null
          position?: number
          title?: string
          video_storage_path?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lessons_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      media_config: {
        Row: {
          allowed_mime_types: string[]
          bucket: string
          file_size_limit: number
          updated_at: string
        }
        Insert: {
          allowed_mime_types: string[]
          bucket: string
          file_size_limit: number
          updated_at?: string
        }
        Update: {
          allowed_mime_types?: string[]
          bucket?: string
          file_size_limit?: number
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read: boolean
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read?: boolean
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read?: boolean
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          coins: number
          created_at: string
          display_name: string | null
          followers: number
          id: string
          score: number
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          coins?: number
          created_at?: string
          display_name?: string | null
          followers?: number
          id: string
          score?: number
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          coins?: number
          created_at?: string
          display_name?: string | null
          followers?: number
          id?: string
          score?: number
          updated_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          body: string | null
          course_id: string
          created_at: string
          id: string
          rating: number
          user_id: string
        }
        Insert: {
          body?: string | null
          course_id: string
          created_at?: string
          id?: string
          rating: number
          user_id: string
        }
        Update: {
          body?: string | null
          course_id?: string
          created_at?: string
          id?: string
          rating?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _learner_entitled: {
        Args: { _course: string; _lesson: string; _user: string }
        Returns: boolean
      }
      _new_certificate_number: { Args: never; Returns: string }
      _object_course_id: { Args: { _name: string }; Returns: string }
      add_lesson_bookmark: {
        Args: { _course_id: string; _lesson_id: string }
        Returns: string
      }
      apply_for_instructor: { Args: { _reason?: string }; Returns: string }
      approve_course: {
        Args: { _course_id: string; _reason?: string }
        Returns: undefined
      }
      approve_instructor_application: {
        Args: { _application_id: string; _reason?: string }
        Returns: undefined
      }
      attach_course_cover: {
        Args: { _course_id: string; _path: string }
        Returns: string
      }
      attach_lesson_video: {
        Args: { _lesson_id: string; _path: string }
        Returns: string
      }
      complete_lesson: {
        Args: { _course_id: string; _lesson_id: string }
        Returns: number
      }
      course_is_editable: { Args: { _course_id: string }; Returns: boolean }
      current_user_has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      delete_lesson_note: { Args: { _lesson_id: string }; Returns: undefined }
      detach_course_cover: { Args: { _course_id: string }; Returns: string }
      detach_lesson_video: { Args: { _lesson_id: string }; Returns: string }
      enroll_free_course: { Args: { _course_id: string }; Returns: string }
      evaluate_course_readiness: {
        Args: { _course_id: string }
        Returns: {
          blockers: Json
          is_ready: boolean
        }[]
      }
      get_admin_course: {
        Args: { _course_id: string }
        Returns: {
          can_unpublish: boolean
          category: string
          completions_count: number
          description: string
          enrollments_count: number
          id: string
          instructor_id: string
          instructor_name: string
          is_published: boolean
          price_cents: number
          review_decision_reason: string
          review_status: Database["public"]["Enums"]["course_review_status"]
          reviews_count: number
          slug: string
          subtitle: string
          title: string
          updated_at: string
        }[]
      }
      get_admin_course_lessons: {
        Args: { _course_id: string }
        Returns: {
          duration_seconds: number
          id: string
          is_preview: boolean
          module_title: string
          position: number
          title: string
        }[]
      }
      get_course_curriculum: {
        Args: { _slug: string }
        Returns: {
          duration_seconds: number
          is_preview: boolean
          lesson_id: string
          lesson_position: number
          lesson_title: string
          module_title: string
        }[]
      }
      get_learner_dashboard: { Args: { _limit?: number }; Returns: Json }
      get_media_limits: {
        Args: never
        Returns: {
          allowed_mime_types: string[]
          bucket: string
          file_size_limit: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      issue_course_certificate: {
        Args: { _course_id: string }
        Returns: string
      }
      list_admin_courses: {
        Args: never
        Returns: {
          category: string
          completions_count: number
          enrollments_count: number
          id: string
          instructor_id: string
          instructor_name: string
          is_published: boolean
          review_status: Database["public"]["Enums"]["course_review_status"]
          reviews_count: number
          slug: string
          title: string
          updated_at: string
        }[]
      }
      list_instructor_applications_admin: {
        Args: {
          _limit?: number
          _offset?: number
          _status?: Database["public"]["Enums"]["instructor_application_status"]
        }
        Returns: {
          application_id: string
          application_reason: string
          avatar_url: string
          created_at: string
          decided_at: string
          decided_by: string
          decision_reason: string
          display_name: string
          is_current_instructor: boolean
          status: Database["public"]["Enums"]["instructor_application_status"]
          total_count: number
          updated_at: string
          user_id: string
        }[]
      }
      reject_course: {
        Args: { _course_id: string; _reason: string }
        Returns: undefined
      }
      reject_instructor_application: {
        Args: { _application_id: string; _reason: string }
        Returns: undefined
      }
      remove_lesson_bookmark: {
        Args: { _lesson_id: string }
        Returns: undefined
      }
      reorder_lessons: {
        Args: { _course_id: string; _lesson_ids: string[] }
        Returns: undefined
      }
      revoke_certificate: {
        Args: { _certificate_id: string; _reason: string }
        Returns: undefined
      }
      revoke_instructor_role: {
        Args: { _reason: string; _user_id: string }
        Returns: undefined
      }
      save_lesson_note: {
        Args: { _body: string; _course_id: string; _lesson_id: string }
        Returns: string
      }
      set_last_lesson: {
        Args: { _course_id: string; _lesson_id: string }
        Returns: undefined
      }
      submit_course_for_review: {
        Args: { _course_id: string }
        Returns: undefined
      }
      submit_review_verified: {
        Args: { _body: string; _course_id: string; _rating: number }
        Returns: undefined
      }
      unpublish_for_edit: {
        Args: { _course_id: string; _reason: string }
        Returns: undefined
      }
      verify_certificate: {
        Args: { _verification_code: string }
        Returns: {
          certificate_number: string
          course_title: string
          instructor_name: string
          issued_at: string
          learner_name: string
          status: string
        }[]
      }
      withdraw_instructor_application: {
        Args: { _application_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "instructor" | "student"
      course_review_status: "draft" | "pending_review" | "approved" | "rejected"
      instructor_application_status:
        | "pending"
        | "approved"
        | "rejected"
        | "withdrawn"
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
      app_role: ["admin", "instructor", "student"],
      course_review_status: ["draft", "pending_review", "approved", "rejected"],
      instructor_application_status: [
        "pending",
        "approved",
        "rejected",
        "withdrawn",
      ],
    },
  },
} as const
