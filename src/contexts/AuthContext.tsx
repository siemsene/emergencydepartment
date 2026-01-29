import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import {
  subscribeToAuthChanges,
  getInstructor,
  isAdmin as checkIsAdmin,
  loginUser,
  logoutUser,
  registerInstructor,
  resetPassword,
  createAdminInstructor
} from '../services/firebaseService';
import { Instructor } from '../types';

interface AuthContextType {
  user: FirebaseUser | null;
  instructor: Instructor | null;
  isAdmin: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (email: string, password: string, name: string, organization?: string) => Promise<void>;
  resetUserPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [instructor, setInstructor] = useState<Instructor | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges(async (firebaseUser) => {
      try {
        setUser(firebaseUser);

        if (firebaseUser) {
          let instructorData = await getInstructor(firebaseUser.uid);

          // If no instructor document exists, check if this is the admin email
          // and auto-create an approved instructor document for them
          if (!instructorData) {
            const adminEmail = import.meta.env.VITE_ADMIN_EMAIL;
            if (adminEmail && firebaseUser.email === adminEmail) {
              instructorData = await createAdminInstructor(
                firebaseUser.uid,
                firebaseUser.email!,
                'Admin'
              );
            }
          }

          setInstructor(instructorData);
          const adminStatus = await checkIsAdmin(firebaseUser.uid);
          setIsAdmin(adminStatus);
        } else {
          setInstructor(null);
          setIsAdmin(false);
        }
      } catch (error) {
        console.error('Error loading user data:', error);
        // Reset state on error to prevent stuck loading
        setInstructor(null);
        setIsAdmin(false);
      } finally {
        setIsLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    await loginUser(email, password);
  };

  const logout = async () => {
    await logoutUser();
    setInstructor(null);
    setIsAdmin(false);
  };

  const register = async (email: string, password: string, name: string, organization?: string) => {
    await registerInstructor(email, password, name, organization);
  };

  const resetUserPassword = async (email: string) => {
    await resetPassword(email);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        instructor,
        isAdmin,
        isLoading,
        login,
        logout,
        register,
        resetUserPassword
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
