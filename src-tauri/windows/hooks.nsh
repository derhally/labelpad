; Make the folder labels are saved to, so it's there the first time you save.
!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$DOCUMENTS\LabelPad"
!macroend
