# Requirements

The repeated recovery controller must project its verified successor lane revision as the new local
writer-lease fence. The predecessor fence must not survive successor review binding.

The reviewed head, cloud lane revision, local fence, PR head, and remote branch head must remain one
exact revision. Any mismatch must fail before the writer registry changes.
