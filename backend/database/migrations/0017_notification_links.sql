-- Where a notification leads in the app: the same page its email links to, such as
-- /office/cases/<id>?tab=notes or /office/messages?with=<sender>. Tapping the notification opens it.
-- Notifications created before this change keep NULL; the app then picks a page by their type.

ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS link_path VARCHAR(300);
