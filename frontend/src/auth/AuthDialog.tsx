/**
 * AuthDialog.tsx — Login / Register Dialog
 *
 * MUI Dialog with Tab switching between Login and Register forms.
 * Calls useAuth() for API integration.
 */

import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
  TextField,
  Button,
  Typography,
  FormControlLabel,
  Checkbox,
  Alert,
  Box,
  CircularProgress,
} from '@mui/material';
import { useAuth } from './AuthContext';

// ─── Props ────────────────────────────────────────────────────────────────────

interface AuthDialogProps {
  open: boolean;
  onClose: () => void;
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateName(name: string): string | null {
  if (name.trim().length < 2) {
    return '昵称至少需要 2 个字符';
  }
  if (name.trim().length > 20) {
    return '昵称最多 20 个字符';
  }
  return null;
}

function validatePassword(password: string): string | null {
  if (password.length < 6) {
    return '密码至少需要 6 位';
  }
  return null;
}

function validateConfirmPassword(password: string, confirm: string): string | null {
  if (password !== confirm) {
    return '两次密码不一致';
  }
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuthDialog({ open, onClose }: AuthDialogProps): JSX.Element {
  const { login, register } = useAuth();
  const [tab, setTab] = useState(0);

  // Form state
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});

  const isLogin = tab === 0;

  const resetForm = useCallback(() => {
    setName('');
    setPassword('');
    setConfirmPassword('');
    setRememberMe(true);
    setError(null);
    setFieldErrors({});
  }, []);

  const handleTabChange = useCallback(
    (_e: React.SyntheticEvent, newValue: number) => {
      setTab(newValue);
      setError(null);
      setFieldErrors({});
    },
    [],
  );

  const handleSubmit = useCallback(async () => {
    setError(null);

    // Validate
    const errors: Record<string, string | null> = {};
    errors.name = validateName(name);
    errors.password = validatePassword(password);
    if (!isLogin) {
      errors.confirmPassword = validateConfirmPassword(password, confirmPassword);
    }
    setFieldErrors(errors);

    const hasErrors = Object.values(errors).some((e) => e !== null);
    if (hasErrors) {
      return;
    }

    setLoading(true);

    try {
      let result: { success: boolean; error?: string };
      if (isLogin) {
        result = await login(name, password);
      } else {
        result = await register(name, password);
      }

      if (result.success) {
        resetForm();
        onClose();
      } else {
        setError(result.error ?? '操作失败，请重试');
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [isLogin, name, password, confirmPassword, login, register, onClose, resetForm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: '#1e1e1e',
          color: '#ccc',
          borderRadius: 2,
          border: '1px solid #333',
        },
      }}
    >
      <DialogTitle sx={{ pb: 0, textAlign: 'center', color: '#ccc' }}>
        <Tabs
          value={tab}
          onChange={handleTabChange}
          variant="fullWidth"
          sx={{
            mb: 1,
            '& .MuiTabs-indicator': { bgcolor: '#629924' },
            '& .MuiTab-root': {
              color: '#888',
              fontSize: '0.9rem',
              textTransform: 'none',
              '&.Mui-selected': { color: '#629924' },
            },
          }}
        >
          <Tab label="登录" />
          <Tab label="注册" />
        </Tabs>
      </DialogTitle>

      <DialogContent sx={{ pt: 2 }}>
        {error !== null && (
          <Alert
            severity="error"
            sx={{
              mb: 2,
              bgcolor: 'rgba(229,62,62,0.1)',
              color: '#e53e3e',
              '& .MuiAlert-icon': { color: '#e53e3e' },
            }}
            onClose={() => setError(null)}
          >
            {error}
          </Alert>
        )}

        <Box component="form" onKeyDown={handleKeyDown} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="昵称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            size="small"
            autoFocus
            error={fieldErrors.name !== undefined && fieldErrors.name !== null}
            helperText={fieldErrors.name ?? undefined}
            inputProps={{ maxLength: 20 }}
            sx={textFieldStyles}
          />

          <TextField
            label="密码"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            size="small"
            error={fieldErrors.password !== undefined && fieldErrors.password !== null}
            helperText={fieldErrors.password ?? (isLogin ? undefined : '至少 6 位')}
            sx={textFieldStyles}
          />

          {!isLogin && (
            <TextField
              label="确认密码"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              fullWidth
              size="small"
              error={
                fieldErrors.confirmPassword !== undefined &&
                fieldErrors.confirmPassword !== null
              }
              helperText={fieldErrors.confirmPassword ?? undefined}
              sx={textFieldStyles}
            />
          )}

          {isLogin && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  size="small"
                  sx={{
                    color: '#666',
                    '&.Mui-checked': { color: '#629924' },
                  }}
                />
              }
              label={
                <Typography variant="caption" color="#888">
                  记住我
                </Typography>
              }
            />
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 0 }}>
        <Button
          onClick={handleClose}
          sx={{
            color: '#888',
            textTransform: 'none',
            '&:hover': { color: '#aaa' },
          }}
        >
          取消
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={loading}
          variant="contained"
          sx={{
            bgcolor: '#629924',
            '&:hover': { bgcolor: '#507d1e' },
            textTransform: 'none',
            minWidth: 100,
          }}
        >
          {loading ? (
            <CircularProgress size={20} sx={{ color: '#fff' }} />
          ) : isLogin ? (
            '登录'
          ) : (
            '注册'
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Shared text field styles ─────────────────────────────────────────────────

const textFieldStyles = {
  '& .MuiInputLabel-root': { color: '#777', fontSize: '0.85rem' },
  '& .MuiInputBase-root': {
    color: '#ccc',
    fontSize: '0.9rem',
    bgcolor: '#252525',
  },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#444' },
  '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': {
    borderColor: '#555',
  },
  '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
    borderColor: '#629924',
  },
  '& .MuiFormHelperText-root': { color: '#e53e3e', fontSize: '0.7rem' },
};
