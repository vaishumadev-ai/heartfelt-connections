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
      courses: {
        Row: {
          audience: string[]
          category: string
          certificate: boolean
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
          last_lesson_id: string | null
          progress: number
          user_id: string
        }
        Insert: {
          course_id: string
          enrolled_at?: string
          id?: string
          last_lesson_id?: string | null
          progress?: number
          user_id: string
        }
        Update: {
          course_id?: string
          enrolled_at?: string
          id?: string
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
      apply_for_instructor: { Args: { _reason?: string }; Returns: string }
      approve_course: {
        Args: { _course_id: string; _reason?: string }
        Returns: undefined
      }
      approve_instructor_application: {
        Args: { _application_id: string; _reason?: string }
        Returns: undefined
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
      enroll_free_course: { Args: { _course_id: string }; Returns: string }
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
      reject_course: {
        Args: { _course_id: string; _reason: string }
        Returns: undefined
      }
      reject_instructor_application: {
        Args: { _application_id: string; _reason: string }
        Returns: undefined
      }
      revoke_instructor_role: {
        Args: { _reason: string; _user_id: string }
        Returns: undefined
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
