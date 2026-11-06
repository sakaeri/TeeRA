-- お知らせメールのボタンからそのままログインして開く鍵
ALTER TYPE "AccountActionTokenKind" ADD VALUE IF NOT EXISTS 'EMAIL_LOGIN';
