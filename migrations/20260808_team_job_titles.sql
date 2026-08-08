-- Adiciona o cargo profissional sem alterar o nível técnico de acesso.
-- Pode ser executada várias vezes com segurança em bancos já existentes.
ALTER TABLE organization_members
  ADD COLUMN IF NOT EXISTS job_title TEXT NOT NULL DEFAULT '';

ALTER TABLE organization_invitations
  ADD COLUMN IF NOT EXISTS job_title TEXT NOT NULL DEFAULT '';

UPDATE organization_members
SET job_title = 'Proprietário da operação'
WHERE role = 'owner' AND job_title = '';
